import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { AnalysisDocument, ResultRow } from "../../frontend/src/api.ts";
import { analysisFiles, createAnalysisPackage, storedZip } from "../../frontend/src/features/analysisExports.ts";
import type { AnalysisExportInput, ExportFile } from "../../frontend/src/features/analysisExports.ts";
import { importAnalysisPackage, MAX_ANALYSIS_IMPORT_BYTES } from "../../frontend/src/features/analysisImports.ts";
import { createOverviewFilters, filterOverviewRows } from "../../frontend/src/features/overview.ts";
import { candidateKey, guideKey } from "../../frontend/src/features/resultIdentity.ts";
import { previewAssayEvidence } from "../../frontend/src/features/assayEvidence.ts";

const date = new Date("2026-09-19T12:34:56.789Z");
const dna = "A".repeat(20) + "AGG";
const otherDna = "C".repeat(20) + "TGG";
/** The reader deliberately uses null-prototype JSON objects; compare persisted values, not prototypes. */
function plain<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
function row(index: number, extra: Partial<ResultRow> = {}): ResultRow {
  return { id: "same-source-id", row_index: index, target: dna, off_target: dna, guide_id: "guide-a", scores: { k1: 0.12345678901234567, k2: 0, k3: -0.125 }, assembly: "GRCh38", chromosome: "1", start: 100 + index * 100, end: 123 + index * 100, coordinate_system: "0-based half-open", strand: "+", ...extra };
}
function input(overrides: Partial<AnalysisExportInput> = {}): AnalysisExportInput {
  const first = row(7), second = row(8), third = row(9, { off_target: otherDna, guide_id: "guide-b" });
  const rows = [first, second, third], filters = { ...createOverviewFilters(), guideKey: guideKey(third) };
  return {
    document: { rows, metadata: { mode: "pairs", candidate_scope: "Supplied pairs", models: { tokenizer_sha256: "kept" } } },
    filteredRows: [third], selectedRows: [first], filters: { ...filters, sort: "input", order: "asc" },
    workspace: { filters, sort: "input", ascending: true, showCfd: true },
    selectionNotes: { [candidateKey(first)]: ["Hidden by current guide filter", "<script>plain-text-note</script>"] },
    job: { id: "public-id", mode: "pairs", models: [1, 2, 3], name: "Archive test", created_at: "2026-09-19T12:00:00Z" },
    frontendBuild: "synthetic-test-build", generatedAt: date, citation: "Synthetic test citation", license: "MIT",
    ...overrides,
  };
}
async function mutateJson(files: ExportFile[], name: string, mutate: (value: any) => unknown): Promise<ExportFile[]> {
  return Promise.all(files.map(async file => {
    if (file.name !== name) return file;
    const value = mutate(JSON.parse(await file.data.text()));
    return { ...file, data: new Blob([JSON.stringify(value)]) };
  }));
}
async function packageFiles(files: ExportFile[]) { return storedZip(files, date); }
async function change(inputValue: AnalysisExportInput, name: string, mutate: (value: any) => unknown) {
  return packageFiles(await mutateJson(await analysisFiles(inputValue), name, mutate));
}
async function legacyFiles(value = input()): Promise<ExportFile[]> {
  let files = await analysisFiles(value);
  files = await mutateJson(files, "provenance-settings.json", manifest => { manifest.export_schema_version = "1.0"; delete manifest.workspace; return manifest; });
  files = await mutateJson(files, "schema.json", schema => ({ ...schema, export_schema_version: "1.0" }));
  return mutateJson(files, "selection-notes.json", selected => { selected.rows.forEach((entry: any) => delete entry.result_index); return selected; });
}
async function mutateBytes(blob: Blob, mutate: (bytes: Uint8Array, view: DataView) => void): Promise<Blob> {
  const buffer = await blob.arrayBuffer(), bytes = new Uint8Array(buffer); mutate(bytes, new DataView(buffer)); return new Blob([bytes]);
}
function directoryRecords(view: DataView) {
  const count = view.getUint16(view.byteLength - 12, true), records: { central: number; local: number; nameLength: number }[] = [];
  let central = view.getUint32(view.byteLength - 6, true);
  for (let i = 0; i < count; i++) { const nameLength = view.getUint16(central + 28, true); records.push({ central, local: view.getUint32(central + 42, true), nameLength }); central += 46 + nameLength; }
  return records;
}

test("Save/Open roundtrip restores complete rows, nondefault view, hidden selection, precision and duplicate source IDs", async () => {
  const initial = input(), archive = await createAnalysisPackage(initial), restored = await importAnalysisPackage(archive);
  assert.deepEqual(plain(restored.document.rows), initial.document.rows);
  assert.equal(Object.getPrototypeOf(restored.document.rows[0]), null);
  assert.equal(restored.document.rows[0].scores.k1, 0.12345678901234567);
  assert.deepEqual(restored.state.filters, initial.workspace!.filters);
  assert.equal(restored.state.sort, "input"); assert.equal(restored.state.ascending, true); assert.equal(restored.state.showCfd, true);
  assert.deepEqual(restored.state.selectedKeys, [candidateKey(initial.document.rows[0])]);
  assert.deepEqual(restored.state.selectionNotes[candidateKey(initial.document.rows[0])], initial.selectionNotes![candidateKey(initial.document.rows[0])]);
  assert.equal(restored.source.frontendBuild, "synthetic-test-build"); assert.equal(restored.savedAt, date.toISOString());
  assert.equal(restored.source.exportSchemaVersion, "1.1"); assert.equal(restored.source.workspaceSchemaVersion, "1.0");
  const again = await importAnalysisPackage(await createAnalysisPackage({ ...initial, document: restored.document, filteredRows: filterOverviewRows(restored.document.rows, restored.state.filters), selectedRows: restored.document.rows.filter(row => restored.state.selectedKeys.includes(candidateKey(row))), workspace: restored.state, selectionNotes: restored.state.selectionNotes }));
  assert.deepEqual(again.document, restored.document); assert.deepEqual(again.state, restored.state);
});

test("opening is offline, treats HTML/hostile strings as data and never restores credentials", async () => {
  const initial = input();
  initial.document.metadata = { ...initial.document.metadata, source_url: "https://should-not-fetch.invalid/data", text: "<img src=x onerror=alert(1)>", token: "secret", nested: { authorization: "Bearer hidden", tokenizer_sha256: "retained" } };
  let files = await analysisFiles(initial);
  files = files.map(file => file.name === "report.html" ? { ...file, data: new Blob(["<script>throw new Error('must never execute')</script>"]) } : file);
  files = await mutateJson(files, "provenance-settings.json", manifest => { manifest.job.token = "injected-secret"; manifest.job.status = "running"; manifest.job.expires_at = "tomorrow"; return manifest; });
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Opening attempted network access"); };
  try {
    const restored = await importAnalysisPackage(await packageFiles(files));
    assert.equal(restored.document.metadata.text, "<img src=x onerror=alert(1)>");
    assert.equal(restored.document.metadata.token, undefined);
    assert.deepEqual(plain(restored.document.metadata.nested), { tokenizer_sha256: "retained" });
    assert.equal(Object.getPrototypeOf(restored.document.metadata.nested), null);
    assert.equal((restored.job as any).token, undefined); assert.equal((restored.job as any).status, undefined); assert.equal((restored.job as any).expires_at, undefined);
  } finally { globalThis.fetch = fetchBefore; }
});

test("legacy schema 1.0 packages reopen with explicit missing-state warnings and unchanged joins", async () => {
  const restored = await importAnalysisPackage(await packageFiles(await legacyFiles()));
  assert.equal(restored.source.exportSchemaVersion, "1.0"); assert.equal(restored.source.workspaceSchemaVersion, undefined);
  assert.equal(restored.state.showCfd, false); assert.equal(restored.state.ascending, true);
  assert.match(restored.source.warnings.join(" "), /older export.*view setting|older export did not explicitly/);
  assert.match(restored.source.warnings.join(" "), /observations|Observations/);
  assert.equal(restored.state.selectedKeys.length, 1);
});

test("zero-hit documents retain submitted guides, provenance and explicit empty saved state", async () => {
  const document: AnalysisDocument = { rows: [], metadata: { mode: "genome", submitted_guides: [{ id: "zero-hit-guide", target: dna }], candidate_scope: "Bounded zero-hit search" } };
  const restored = await importAnalysisPackage(await createAnalysisPackage(input({ document, filteredRows: [], selectedRows: [], workspace: { filters: createOverviewFilters(), sort: "k1", ascending: false, showCfd: false }, selectionNotes: {} })));
  assert.deepEqual(restored.document.rows, []); assert.deepEqual(plain(restored.document.metadata.submitted_guides), document.metadata.submitted_guides);
  assert.deepEqual(restored.state.selectedKeys, []); assert.equal(restored.state.experimentalEvidence, null);
});

test("all frozen public result documents satisfy the saved scientific-row contract", async () => {
  for (const name of ["reference-walkthrough", "multiple-exact-matches", "no-hits"]) {
    const document = JSON.parse(await readFile(new URL(`../../frontend/public/demonstrations/${name}.json`, import.meta.url), "utf8"));
    const restored = await importAnalysisPackage(await createAnalysisPackage(input({ document, filteredRows: document.rows, selectedRows: [], selectionNotes: {}, workspace: { filters: createOverviewFilters(), sort: "k1", ascending: false, showCfd: false } })));
    assert.deepEqual(plain(restored.document.rows), document.rows, name);
    assert.deepEqual(plain(restored.document.metadata.submitted_guides), document.metadata.submitted_guides, name);
  }
});

test("evidence restore recomputes ambiguous, duplicate, unmatched and zero-valued observations", async () => {
  const initial = input(), text = `target,off_target,value\n${dna},${dna},12\n${dna},${dna},12\n${otherDna},${otherDna},0\n`;
  const evidence = previewAssayEvidence(text, { assay: "Synthetic assay", matchMode: "pair-sequence", valueKind: "read_count" }, initial.document.rows).state!;
  evidence.metadata.source_filename = "synthetic.csv"; evidence.metadata.source_sha256 = "a".repeat(64);
  const restored = await importAnalysisPackage(await createAnalysisPackage({ ...initial, experimentalEvidence: evidence }));
  assert.deepEqual(restored.state.experimentalEvidence, evidence);
  assert.equal(restored.state.experimentalEvidence!.summary.ambiguous_observations, 2);
  assert.equal(restored.state.experimentalEvidence!.summary.unmatched_observations, 1);
  assert.equal(restored.state.experimentalEvidence!.summary.duplicate_observations, 1);
  for (const mutation of [
    (saved: any) => { saved.observations[0].match_result_indices = [2]; return saved; },
    (saved: any) => { saved.per_row[0].candidate_key = "wrong"; return saved; },
    (saved: any) => { saved.summary.zero_observations = 999; return saved; },
  ]) await assert.rejects(() => change({ ...initial, experimentalEvidence: evidence }, "experimental-evidence.json", mutation).then(importAnalysisPackage), /disagree/);
});

test("coordinate observations retain original 1-based declarations while matching stored 0-based loci", async () => {
  const initial = input(), evidence = previewAssayEvidence("chromosome,start,end,strand,value\nchr1,801,823,+,0\n", { assay: "Synthetic coordinates", matchMode: "coordinates", valueKind: "read_count", assembly: "GRCh38", coordinateSystem: "1-based inclusive" }, initial.document.rows).state!;
  assert.ok(evidence);
  const restored = await importAnalysisPackage(await createAnalysisPackage({ ...initial, experimentalEvidence: evidence }));
  assert.deepEqual(restored.state.experimentalEvidence, evidence);
});

test("inconsistent identities, selection counts, filters, score data and unsupported versions fail atomically", async () => {
  const mutations: [string, (value: any) => unknown, RegExp][] = [
    ["selection-notes.json", saved => { saved.rows[0].result_index = 2; return saved; }, /selection result index/],
    ["selection-notes.json", saved => { saved.rows[0].candidate_key = "unknown"; return saved; }, /does not match/],
    ["provenance-settings.json", saved => { saved.counts.selected = 2; return saved; }, /selected-row count/],
    ["provenance-settings.json", saved => { saved.workspace.view.filters.guideKey = ""; return saved; }, /filtered-result count/],
    ["provenance-settings.json", saved => { saved.export_schema_version = "9.0"; return saved; }, /schema.*unsupported/],
    ["provenance-settings.json", saved => { saved.workspace.schema_version = "9.0"; return saved; }, /workspace schema/],
    ["results-full.json", saved => { saved.rows[0].scores.k1 = "0.1"; return saved; }, /finite number/],
    ["results-full.json", saved => { saved.rows[0].off_target = "A".repeat(20); return saved; }, /23 uppercase/],
    ["results-full.json", saved => { saved.metadata.candidate_scope = { nested: "would break String(null-prototype object)" }; return saved; }, /candidate scope.*text/],
    ["results-full.json", saved => { saved.rows[0].annotations = { status: "annotated", features: "not-an-array", categories: [] }; return saved; }, /annotation features.*array/],
    ["results-full.json", saved => { saved.rows[1].row_index = saved.rows[0].row_index; return saved; }, /row_index.*unique/],
  ];
  for (const [name, mutate, message] of mutations) await assert.rejects(() => change(input(), name, mutate).then(importAnalysisPackage), message);
});

test("STORE reader rejects corrupt CRC, unsupported compression/encryption, unsafe paths, duplicate entries and directory tampering", async () => {
  const archive = await createAnalysisPackage(input());
  const changes: [((bytes: Uint8Array, view: DataView) => void), RegExp][] = [
    [(bytes, view) => { const entry = directoryRecords(view)[0]; bytes[entry.local + 30 + entry.nameLength + 1] ^= 1; }, /CRC32/],
    [(_bytes, view) => { view.setUint16(directoryRecords(view)[0].central + 10, 8, true); }, /compressed/],
    [(_bytes, view) => { view.setUint16(directoryRecords(view)[0].central + 8, 1, true); }, /encrypted/],
    [(bytes, view) => { const entry = directoryRecords(view).find(entry => new TextDecoder().decode(bytes.subarray(entry.central + 46, entry.central + 46 + entry.nameLength)) === "report.html")!; bytes.set(new TextEncoder().encode("../bad.html"), entry.central + 46); bytes.set(new TextEncoder().encode("../bad.html"), entry.local + 30); }, /unsafe path/],
    [(bytes, view) => { const entry = directoryRecords(view).find(entry => new TextDecoder().decode(bytes.subarray(entry.central + 46, entry.central + 46 + entry.nameLength)) === "report.html")!; bytes.set(new TextEncoder().encode("schema.json"), entry.central + 46); bytes.set(new TextEncoder().encode("schema.json"), entry.local + 30); }, /duplicate/],
    [(_bytes, view) => { view.setUint32(directoryRecords(view)[1].central + 42, 0, true); }, /overlapping/],
    [(_bytes, view) => { view.setUint16(view.byteLength - 12, 33, true); }, /file count/],
  ];
  for (const [mutate, message] of changes) await assert.rejects(() => mutateBytes(archive, mutate).then(importAnalysisPackage), message);
  await assert.rejects(() => importAnalysisPackage(new Blob(["not-a-zip"])), /complete analysis ZIP/);
  await assert.rejects(() => importAnalysisPackage(archive.slice(0, archive.size - 2)), /ZIP32/);
});

test("size is bounded before materialization; deep JSON, unsafe keys and cancellation are rejected", async () => {
  const fakeHuge = new Blob([]);
  Object.defineProperty(fakeHuge, "size", { value: MAX_ANALYSIS_IMPORT_BYTES + 1 });
  Object.defineProperty(fakeHuge, "arrayBuffer", { value: () => { throw new Error("should not materialize"); } });
  await assert.rejects(() => importAnalysisPackage(fakeHuge), /256 MiB/);
  for (const source of ['{"metadata":{},"rows":[],"__proto__":{}}', '{"metadata":' + '{"a":'.repeat(41) + '0' + '}'.repeat(41) + ',"rows":[]}']) {
    const files = (await analysisFiles(input())).map(file => file.name === "results-full.json" ? { ...file, data: new Blob([source]) } : file);
    await assert.rejects(() => packageFiles(files).then(importAnalysisPackage), /unsafe object key|nested too deeply/);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => importAnalysisPackage(new Blob(), { signal: controller.signal }), /cancelled/);
});

test("60,000-row saved analysis is within published opening limits, yields and preserves last-row state", async () => {
  const rows = Array.from({ length: 60_000 }, (_, index) => row(index));
  const filters = createOverviewFilters(), archive = await createAnalysisPackage(input({ document: { rows, metadata: {} }, filteredRows: rows, selectedRows: [rows.at(-1)!], workspace: { filters, sort: "k2", ascending: true, showCfd: false }, selectionNotes: { [candidateKey(rows.at(-1)!)]: ["Last row"] } }));
  assert.ok(archive.size < MAX_ANALYSIS_IMPORT_BYTES);
  let yielded = false; const timer = setTimeout(() => { yielded = true; }, 0);
  const restored = await importAnalysisPackage(archive); clearTimeout(timer);
  assert.equal(yielded, true); assert.equal(restored.document.rows.length, 60_000);
  assert.equal(restored.document.rows.at(-1)!.row_index, 59_999);
  assert.deepEqual(restored.state.selectedKeys, [candidateKey(rows.at(-1)!)]);
  assert.deepEqual(restored.state.selectionNotes[candidateKey(rows.at(-1)!)], ["Last row"]);
});
