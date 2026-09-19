import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import {
  createDemonstrationLoader,
  demonstrationAsset,
  demonstrationInput,
  validateDemonstrationDocument,
  validateManifest,
} from "../../frontend/src/features/demonstrations.ts";

const directory = new URL("../../frontend/public/demonstrations/", import.meta.url);
const manifestBytes = await readFile(new URL("manifest.json", directory));
const rawManifest = JSON.parse(manifestBytes.toString("utf8"));
const manifest = validateManifest(rawManifest);
const first = manifest.scenarios[0];
const fileBytes = await readFile(new URL(first.document_filename!, directory));
const rawDocument = JSON.parse(fileBytes.toString("utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const crypto = webcrypto as unknown as Crypto;

function memoryFetch(overrides: Record<string, Uint8Array | string> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const filename = url.slice(url.lastIndexOf("/") + 1);
    const bytes = overrides[filename] ?? await readFile(new URL(filename, directory));
    return new Response(typeof bytes === "string" ? bytes : new Uint8Array(bytes));
  };
  return { calls, fetcher };
}

test("all recorded examples validate with exact file hashes and complete result counts", async () => {
  assert.deepEqual(manifest.scenarios.map((scenario) => scenario.id), ["reference-walkthrough", "multiple-exact-matches", "no-hits", "missing-pam"]);
  for (const scenario of manifest.scenarios.filter((scenario) => scenario.kind === "result")) {
    const bytes = await readFile(new URL(scenario.document_filename!, directory));
    assert.equal(sha256(bytes), scenario.document_sha256);
    const document = validateDemonstrationDocument(JSON.parse(bytes.toString("utf8")), scenario);
    assert.equal(document.rows.length, scenario.completed_job?.result_count);
    assert.equal(document.metadata.max_mismatches, scenario.input.max_mismatches);
  }
});

test("static URLs preserve GitHub Pages base and reject traversal, external URLs and encoded filenames", () => {
  assert.equal(demonstrationAsset("/OfftargetPred-web-server/", "no-hits.json"), "/OfftargetPred-web-server/demonstrations/no-hits.json");
  assert.equal(demonstrationAsset("/", "manifest.json"), "/demonstrations/manifest.json");
  assert.equal(demonstrationAsset("/OfftargetPred-web-server", "manifest.json"), "/OfftargetPred-web-server/demonstrations/manifest.json");
  for (const filename of ["../private.json", "https://other.test/x.json", "%2fsecret.json", "nested/x.json"]) assert.throws(() => demonstrationAsset("/", filename), /filename/);
});

test("loader requests only static assets, omits credentials, verifies checksum and caches completed loads", async () => {
  const memory = memoryFetch();
  const loader = createDemonstrationLoader("/OfftargetPred-web-server/", { fetcher: memory.fetcher, crypto });
  const [left, right] = await Promise.all([loader.manifest(), loader.manifest()]);
  assert.strictEqual(left, right);
  const [a, b] = await Promise.all([loader.document(left.scenarios[0]), loader.document(left.scenarios[0])]);
  assert.strictEqual(a, b);
  assert.equal(a.integrity, "verified");
  assert.equal(a.document.rows.length, 15);
  assert.strictEqual(await loader.document(left.scenarios[0]), a);
  assert.equal(memory.calls.length, 2);
  for (const call of memory.calls) {
    assert.match(call.url, /^\/OfftargetPred-web-server\/demonstrations\/[a-z-]+\.json$/);
    assert.equal(call.init?.method, "GET");
    assert.equal(call.init?.credentials, "omit");
    assert.equal(call.init?.headers, undefined);
    assert.equal(call.init?.body, undefined);
    assert.equal(call.init?.referrerPolicy, "no-referrer");
  }
});

test("missing crypto retains schema validation and explicitly reports integrity unavailable", async () => {
  const loader = createDemonstrationLoader("/", { fetcher: memoryFetch().fetcher, crypto: null });
  assert.equal((await loader.document(first)).integrity, "unavailable");
  const malformed = createDemonstrationLoader("/", {
    fetcher: memoryFetch({ [first.document_filename!]: JSON.stringify({ metadata: {}, rows: [] }) }).fetcher,
    crypto: null,
  });
  await assert.rejects(() => malformed.document(first), /result document/);
});

test("integrity failure is never displayed or cached and a retry can recover", async () => {
  let count = 0;
  const loader = createDemonstrationLoader("/", { crypto, fetcher: async () => new Response(new Uint8Array(count++ ? fileBytes : new TextEncoder().encode("{}"))) });
  await assert.rejects(() => loader.document(first), /checksum/);
  assert.equal((await loader.document(first)).document.rows.length, 15);
  assert.equal(count, 2);
});

test("failed manifest and document fetches give a retry message and do not poison the cache", async () => {
  let count = 0;
  const loader = createDemonstrationLoader("/", { fetcher: async () => count++ ? new Response(new Uint8Array(manifestBytes)) : new Response("missing", { status: 404 }) });
  await assert.rejects(() => loader.manifest(), /HTTP 404.*retry/);
  assert.equal((await loader.manifest()).scenarios.length, 4);
  const unavailable = createDemonstrationLoader("/", { fetcher: async () => { throw new TypeError("network down"); } });
  await assert.rejects(() => unavailable.document(first), /connection and retry/);
});

test("zero-hit and invalid-input cases never manufacture candidate scores", async () => {
  const loader = createDemonstrationLoader("/", { fetcher: memoryFetch().fetcher, crypto });
  const zero = await loader.document(manifest.scenarios[2]);
  assert.deepEqual(zero.document.rows, []);
  assert.equal((zero.document.metadata.submitted_guides as unknown[]).length, 1);
  const invalid = manifest.scenarios[3];
  assert.equal(invalid.input.input.length, 20);
  assert.match(invalid.expected_error!.detail, /exactly 23 bases/);
  await assert.rejects(() => loader.document(invalid), /no prediction result/);
});

test("prefill copies preserve exact settings and intended locus without mutating the frozen source", () => {
  const input = demonstrationInput(first);
  assert.deepEqual(input, first.input);
  assert.equal(input.max_mismatches, 1);
  assert.deepEqual(input.intended_loci, [{ assembly: "GRCh38", chromosome: "1", end: 100079, start: 100056, strand: "+", target: "TGAGACTCTTGCAGTCACACAGG" }]);
  input.models.pop(); input.intended_loci![0].start = 0; input.input = "edited";
  assert.equal(first.input.models.length, 3);
  assert.equal(first.input.intended_loci![0].start, 100056);
  assert.equal(first.input.input.length, 23);
  assert.equal(demonstrationInput(manifest.scenarios[1]).max_mismatches, 0);
});

test("manifest validation rejects incompatible schemas, unsafe assets and invalid scenario identities", () => {
  for (const change of [
    (value: typeof rawManifest) => { value.schema_version = 2; },
    (value: typeof rawManifest) => { value.scenarios[1].id = value.scenarios[0].id; },
    (value: typeof rawManifest) => { value.scenarios[0].document_filename = "../other.json"; },
    (value: typeof rawManifest) => { value.scenarios[0].completed_job.result_count = 101; },
    (value: typeof rawManifest) => { value.scenarios[0].input.max_mismatches = 5; },
    (value: typeof rawManifest) => { value.scenarios[0].input.intended_loci[0].end += 1; },
    (value: typeof rawManifest) => { value.scenarios[3].completed_job = value.scenarios[0].completed_job; },
  ]) { const value = clone(rawManifest); change(value); assert.throws(() => validateManifest(value), /unsupported or inconsistent/); }
});

test("document validation rejects missing rows, mismatched schema, duplicate identities and malformed scores", () => {
  for (const change of [
    (value: typeof rawDocument) => { value.rows.pop(); },
    (value: typeof rawDocument) => { value.metadata.schema_version = "3.0"; },
    (value: typeof rawDocument) => { value.rows[1].row_index = value.rows[0].row_index; },
    (value: typeof rawDocument) => { value.rows[0].scores.k1 = "not-a-number"; },
    (value: typeof rawDocument) => { value.rows[0].annotations.features = "wrong"; },
  ]) { const value = clone(rawDocument); change(value); assert.throws(() => validateDemonstrationDocument(value, first), /unsupported or inconsistent/); }
});

test("malformed JSON and oversized assets are rejected before rendering", async () => {
  const malformed = createDemonstrationLoader("/", { fetcher: memoryFetch({ "manifest.json": "<html>not JSON</html>" }).fetcher });
  await assert.rejects(() => malformed.manifest(), /JSON file/);
  const oversized = createDemonstrationLoader("/", { fetcher: async () => new Response(" ".repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(() => oversized.manifest(), /asset size/);
});
