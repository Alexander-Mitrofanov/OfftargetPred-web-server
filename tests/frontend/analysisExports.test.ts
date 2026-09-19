import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ResultRow } from "../../frontend/src/api.ts";
import {
  analysisFiles,
  analysisReport,
  createAnalysisPackage,
  csvCell,
  exportManifest,
  resultsCsv,
  resultsCsvBlob,
  sanitizeForExport,
  storedZip,
} from "../../frontend/src/features/analysisExports.ts";
import type { AnalysisExportInput } from "../../frontend/src/features/analysisExports.ts";
import { candidateKey } from "../../frontend/src/features/resultIdentity.ts";
import { previewAssayEvidence } from "../../frontend/src/features/assayEvidence.ts";

const sequence = "A".repeat(20) + "AGG";
function row(patch: Partial<ResultRow> = {}): ResultRow {
  return {
    id: "duplicate",
    row_index: 7,
    guide_id: "guide-a",
    target: sequence,
    off_target: sequence,
    scores: { k1: 0.12345678901234567, k2: 0, k3: -0.125 },
    baselines: { cfd: { score: 0, version: "CFD-test" } },
    assembly: "GRCh38",
    chromosome: "1",
    start: 100,
    end: 123,
    coordinate_system: "0-based half-open",
    strand: "+",
    mismatches: 0,
    ...patch,
  };
}
const first = row(),
  second = row({ row_index: 8, start: 200, end: 223 });
const input: AnalysisExportInput = {
  document: {
    rows: [first, second],
    metadata: {
      release: "test-revision",
      model: { sha256: "abc", tokenizer_sha256: "def" },
    },
  },
  filteredRows: [second],
  selectedRows: [first],
  filters: { guideKey: "guide-a", query: "example" },
  generatedAt: new Date("2026-09-19T12:34:56.789Z"),
  job: {
    id: "public-job-id",
    mode: "genome",
    models: [1, 2, 3],
    name: "test job",
    created_at: "2026-09-19T12:00:00Z",
  },
  citation: "cff-version: 1.2.0\ntitle: OfftargetPred\n",
  license: "MIT License\n",
};

test("analysis package preserves unmatched, duplicate and ambiguous browser-only assay observations", async () => {
  const text = `target,off_target,value\n${sequence},${sequence},12\n${sequence},${sequence},12\n${"C".repeat(20)}AGG,${"C".repeat(20)}AGG,0`;
  const state = previewAssayEvidence(text, { assay: "test", matchMode: "pair-sequence", valueKind: "read_count" }, input.document.rows).state!;
  const files = await analysisFiles({ ...input, experimentalEvidence: state });
  const evidence = JSON.parse(await files.find(file => file.name === "experimental-evidence.json")!.data.text());
  assert.equal(evidence.observations.length, 3);
  assert.equal(evidence.observations[1].duplicate_of, "observation-1");
  assert.equal(evidence.observations[2].status, "unmatched");
  assert.deepEqual(evidence.per_row.map((row: {result_index: number}) => row.result_index), [0, 1]);
  const document = JSON.parse(await files.find(file => file.name === "results-full.json")!.data.text());
  assert.deepEqual(document.rows, input.document.rows);
  assert.equal(document.metadata.experimental_evidence.file, "experimental-evidence.json");
  assert.equal(document.metadata.experimental_evidence.summary.ambiguous_observations, 2);
});

test("credential fields and links are removed recursively without losing model/tokenizer provenance", () => {
  const safe = JSON.parse(
    JSON.stringify(
      sanitizeForExport({
        token: "never-export",
        nested: {
          accessToken: "secret",
          authorization: "Bearer private",
          apiKey: "private",
          model_tokenizer_hash: "keep",
          tokenizer_sha256: "keep-too",
        },
        list: [
          { password: "private", n: 2 },
          "https://example.test/#job=abc&token=private",
          "https://example.test/?%74oken=encoded",
        ],
        jobUrl: "private-url",
        callback: "https://example.test/?X-Amz-Signature=private",
        notes: "Bearer private",
        normal: "https://example.test/paper",
        zero: 0,
      }),
    ),
  );
  assert.deepEqual(safe.nested, {
    model_tokenizer_hash: "keep",
    tokenizer_sha256: "keep-too",
  });
  assert.equal(safe.token, undefined);
  assert.equal(safe.jobUrl, undefined);
  assert.equal(safe.list[0].n, 2);
  assert.equal(safe.list[0].password, undefined);
  assert.equal(safe.list[1], "[private credential or link removed]");
  assert.equal(safe.list[2], "[private credential or link removed]");
  assert.equal(safe.callback, "[private credential or link removed]");
  assert.equal(safe.normal, "https://example.test/paper");
  assert.equal(safe.zero, 0);
});

test("CSV escapes formulas, tabs, quotes and multiline text without rounding numeric scores", () => {
  assert.equal(
    csvCell('=HYPERLINK("https://bad")'),
    '"\'=HYPERLINK(""https://bad"")"',
  );
  assert.equal(csvCell(" \t+SUM(A1:A2)"), '"\' \t+SUM(A1:A2)"');
  assert.equal(csvCell("@evil"), '"\'@evil"');
  assert.equal(csvCell("-evil"), '"\'-evil"');
  assert.equal(csvCell("\ttext"), '"\'\ttext"');
  assert.equal(csvCell('a,b\n"quoted"'), '"a,b\n""quoted"""');
  assert.equal(csvCell(-0.125), '"-0.125"');
  const csv = resultsCsv([first, second]);
  assert.match(csv, /0\.12345678901234566/); // JavaScript's exact stored number, no display rounding.
  assert.equal(csv.split('"duplicate"').length - 1, 2);
  assert.match(csv, /"7","duplicate"/);
  assert.match(csv, /"8","duplicate"/);
  assert.match(csv, /"cfd_unavailable_reason"/);
  assert.match(csv, /"annotation_features"/);
});

test("full, filtered and selected counts are distinct; empty selection is explicit", () => {
  const manifest = exportManifest(input, input.generatedAt!);
  assert.deepEqual(manifest.counts, { full: 2, filtered: 1, selected: 1 });
  assert.equal(manifest.generated_at_utc, "2026-09-19T12:34:56.789Z");
  const empty = exportManifest(
    { ...input, selectedRows: [] },
    input.generatedAt!,
  );
  assert.match(empty.views.selected, /No rows selected/);
  assert.match(resultsCsv([]), /row_index/);
  assert.equal(resultsCsv([]).split("\r\n").length, 2);
});

test("HTML is escaped and script-free, with a visible bounded preview", () => {
  const dangerous = row({
    id: '<script>alert("x")</script>',
    guide_id: "<img src=x onerror=alert(1)>",
  });
  const html = analysisReport(
    {
      ...input,
      document: {
        rows: [dangerous],
        metadata: { description: "</pre><script>bad()</script>" },
      },
      filteredRows: Array(201).fill(dangerous),
      citation: "<script>citation</script>",
    },
    input.generatedAt!,
  );
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /shows 200 of 201 filtered rows/);
  assert.match(html, /default-src 'none'/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 201);
});

test("packages preserve full JSON precision, duplicate IDs, annotation detail and skipped BED rows", async () => {
  const invalid = row({
    row_index: 9,
    assembly: undefined,
    baselines: {
      cfd: { score: null, reason: "unsupported N", version: "test" },
    },
    annotations: {
      status: "unavailable",
      categories: [],
      features: [],
      reason: "not configured",
    },
  });
  const files = await analysisFiles({
    ...input,
    document: {
      rows: [first, second, invalid],
      metadata: { nested: { token: "hidden", scientific_setting: 1 } },
    },
    selectedRows: [invalid],
  });
  const map = new Map(files.map((file) => [file.name, file.data]));
  const json = JSON.parse(await map.get("results-full.json")!.text());
  assert.deepEqual(
    json.rows.map((value: ResultRow) => value.row_index),
    [7, 8, 9],
  );
  assert.equal(json.rows[0].scores.k1, first.scores.k1);
  assert.equal(json.rows[2].baselines.cfd.score, null);
  assert.equal(json.metadata.nested.token, undefined);
  const skipped = JSON.parse(await map.get("bed-skipped.json")!.text());
  assert.equal(skipped.full.exported, 2);
  assert.equal(skipped.full.skipped.length, 1);
  assert.equal(skipped.full.skipped[0].row_index, 9);
  assert.equal(skipped.full.skipped[0].code, "missing_assembly");
  assert.equal(skipped.selected.exported, 0);
  assert.equal(skipped.selected.skipped.length, 1);
  assert.equal(await map.get("shortlist-selected.bed")!.text(), "");
  assert.equal(
    (await map.get("candidates-full.bed")!.text()).split("\n").length,
    3,
  );
  assert.ok(map.has("schema.json"));
  assert.ok(map.has("LICENSE.txt"));
  assert.ok(map.has("CITATION.cff"));
});

test("ZIP interoperates with Python zipfile, validates CRC and CSV including Unicode/newlines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "offtargetpred-export-"));
  try {
    const archivePath = join(directory, "analysis.zip"),
      validationPath = join(directory, "validation.json");
    const unicodeRow = row({ id: 'αβ,\n"hello"' });
    const zip = await createAnalysisPackage({
      ...input,
      document: { rows: [unicodeRow, second], metadata: {} },
      filteredRows: [unicodeRow],
    });
    await writeFile(archivePath, new Uint8Array(await zip.arrayBuffer()));
    execFileSync("python3", [
      "-c",
      `import csv,io,json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n rows=list(csv.DictReader(io.StringIO(z.read('results-full.csv').decode('utf-8'))))\n assert len(rows)==2\n assert rows[0]['id']=='αβ,\\n"hello"'\n assert rows[0]['k1_score']=='0.12345678901234566'\n assert rows[1]['row_index']=='8'\n assert all(i.compress_type==zipfile.ZIP_STORED for i in z.infolist())\n json.dump({'names':z.namelist(),'date':z.getinfo('results-full.json').date_time},open(sys.argv[2],'w'))`,
      archivePath,
      validationPath,
    ]);
    const validation = JSON.parse(await readFile(validationPath, "utf8"));
    assert.equal(validation.names.length, 13);
    assert.deepEqual(validation.date, [2026, 9, 19, 12, 34, 56]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selection notes stay attached to stable candidate identities and only selected rows are exported", async () => {
  const notes = {
    [candidateKey(first)]: [
      "Ranked top 2",
      "<script>unsafe()</script>",
      "https://example.test/#token=private",
    ],
    [candidateKey(second)]: ["Not selected; do not include this note"],
  };
  const files = await analysisFiles({ ...input, selectionNotes: notes });
  const selected = await files
    .find((file) => file.name === "shortlist-selected.csv")!
    .data.text();
  assert.match(selected, /Ranked top 2/);
  assert.doesNotMatch(selected, /Not selected; do not include/);
  assert.doesNotMatch(selected, /token=private/);
  const exportedNotes = JSON.parse(
    await files
      .find((file) => file.name === "selection-notes.json")!
      .data.text(),
  );
  assert.equal(exportedNotes.rows.length, 1);
  assert.equal(exportedNotes.rows[0].row_index, 7);
  assert.equal(
    exportedNotes.rows[0].notes[2],
    "[private credential or link removed]",
  );
});

test("exports can be cancelled and reject unsafe archive paths, duplicate paths and invalid time", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => resultsCsvBlob([first], { signal: controller.signal }),
    /cancelled/,
  );
  const data = new Blob(["123456789"]);
  await assert.rejects(
    () => storedZip([{ name: "../bad.txt", data }], input.generatedAt!),
    /safe/,
  );
  await assert.rejects(
    () =>
      storedZip(
        [
          { name: "x.txt", data },
          { name: "x.txt", data },
        ],
        input.generatedAt!,
      ),
    /unique/,
  );
  await assert.rejects(
    () => storedZip([{ name: "x.txt", data }], new Date("invalid")),
    /time/,
  );
});

test("private links in user identifiers are redacted before BED name normalization", async () => {
  const sensitive = row({ id: "https://example.test/#token=DO_NOT_EXPORT_THIS", guide_id: "https://example.test/?token=DO_NOT_EXPORT_THAT" });
  const files = await analysisFiles({ ...input, document: { rows: [sensitive], metadata: {} }, filteredRows: [sensitive], selectedRows: [sensitive] });
  for (const file of files) assert.doesNotMatch(await file.data.text(), /DO_NOT_EXPORT_THIS|DO_NOT_EXPORT_THAT/, file.name);
});

test("50,000-row CSV uses complete input, yields to event loop and preserves last row", async () => {
  const rows = Array.from({ length: 50_000 }, (_, index) =>
    row({ row_index: index }),
  );
  let yielded = false;
  const timer = setTimeout(() => {
    yielded = true;
  }, 0);
  const blob = await resultsCsvBlob(rows);
  clearTimeout(timer);
  assert.equal(yielded, true);
  const csv = await blob.text();
  assert.equal(csv.split("\r\n").length, 50_002);
  assert.match(csv, /"49999","duplicate"/);
  await assert.rejects(() => resultsCsvBlob([...rows, first]), /50,000/);
});
