import assert from "node:assert/strict";
import test from "node:test";
import { previewToolImport, SYNTHETIC_TOOL_IMPORTS } from "../../frontend/src/features/toolImports.ts";
import type { ToolImportOptions } from "../../frontend/src/features/toolImports.ts";

const seq = "A".repeat(20) + "AGG";
const opts: ToolImportOptions = { format: "cas-offinder-2.4.1", assembly: "GRCh38", guide23: seq };
const cas = SYNTHETIC_TOOL_IMPORTS["cas-offinder-2.4.1"];
const crispor = SYNTHETIC_TOOL_IMPORTS["crispor-offtargets"];
const chop = SYNTHETIC_TOOL_IMPORTS["chopchop-compatible"];
const chopOpts: ToolImportOptions = { format: "chopchop-compatible", assembly: "GRCh38", coordinateSystem: "1-based inclusive", candidateOrientation: "guide-oriented" };

test("Cas-OFFinder 2.4.1 preserves 0-based position and actual lowercase candidate", () => {
  const result = previewToolImport(cas, opts);
  assert.equal(result.canApply, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.rows[0].start, 100);
  assert.equal(result.rows[0].end, 123);
  assert.equal(result.rows[0].off_target, "A".repeat(19) + "CAGG");
  assert.equal(result.rows[0].target, seq);
  assert.equal(result.rows[0].source_id, "line-1");
  assert.match(result.csv, /user-supplied, not reference-verified/);
});

test("Cas negative strand is already guide-oriented and never complemented", () => {
  const result = previewToolImport(cas.replace("\t+\t", "\t-\t"), opts);
  assert.equal(result.rows[0].strand, "-");
  assert.equal(result.rows[0].off_target, "A".repeat(19) + "CAGG");
});

test("CRISPOR bulk export converts 1-based inclusive start and preserves strand", () => {
  const result = previewToolImport(crispor, { ...opts, format: "crispor-offtargets" });
  assert.equal(result.canApply, true);
  assert.equal(result.rows[0].start, 100);
  assert.equal(result.rows[0].end, 123);
  assert.equal(result.rows[0].strand, "-");
  assert.equal(result.rows[0].guide_id, "laboratory-demo");
  assert.equal(result.rows[0].off_target, "A".repeat(19) + "CAGG");
});

test("CRISPOR unknown coordinate variant is rejected instead of shifted silently", () => {
  assert.equal(previewToolImport(crispor.replace("\t101\t123", "\t100\t123"), { ...opts, format: "crispor-offtargets" }).canApply, false);
});

test("CRISPOR seqId disambiguates guide labels across input sequences", () => {
  const input = crispor.replace("guideId\t", "seqId\tguideId\t").replace("\nlaboratory-demo", "\nsample-1\tlaboratory-demo");
  assert.equal(previewToolImport(input, { ...opts, format: "crispor-offtargets" }).rows[0].guide_id, "sample-1:laboratory-demo");
});

test("CHOPCHOP compatible declared site is converted", () => {
  const result = previewToolImport(chop, chopOpts);
  assert.equal(result.canApply, true);
  assert.equal(result.rows[0].source_id, "synthetic-site");
  assert.equal(result.rows[0].start, 100);
});

test("forward-reference negative sequence is reverse-complemented only when declared", () => {
  const forward = "CCTG" + "T".repeat(19);
  const input = chop.replace("AAAAAAAAAAAAAAAAAAACAGG,chr1:101-123,+", `${forward},chr1:101-123,-`);
  const result = previewToolImport(input, { ...chopOpts, candidateOrientation: "forward-reference" });
  assert.equal(result.canApply, true);
  assert.equal(result.rows[0].off_target, "A".repeat(19) + "CAGG");
  assert.equal(result.rows[0].start, 100);
});

test("CHOPCHOP separate actual PAM can complete an explicitly oriented 20-mer", () => {
  const input = `Guide sequence,Target sequence,PAM,Genomic location,Strand\n${seq},${"A".repeat(20)},AGG,chr1:101,+`;
  assert.equal(previewToolImport(input, chopOpts).rows[0].off_target, seq);
  assert.equal(previewToolImport(input, { ...chopOpts, candidateOrientation: "forward-reference" }).canApply, false);
});

test("native CHOPCHOP counts and missing candidate strand are rejected", () => {
  assert.equal(previewToolImport(chop.replace("Strand", "Guide strand"), chopOpts).canApply, false);
  const counts = chop.replace(",Strand\n", ",Strand,MM0\n").replace("123,+", "123,+,1");
  assert.match(previewToolImport(counts, chopOpts).issues[0].message, /guide ranking table/);
});

test("CHOPCHOP requires both coordinate and orientation declarations", () => {
  assert.equal(previewToolImport(chop, { ...chopOpts, coordinateSystem: undefined }).canApply, false);
  assert.equal(previewToolImport(chop, { ...chopOpts, candidateOrientation: undefined }).canApply, false);
});

test("assembly declaration is mandatory", () => {
  const result = previewToolImport(cas, { ...opts, assembly: "" });
  assert.equal(result.canApply, false);
  assert.equal(result.csv, "");
  assert.equal(result.issues[0].code, "assembly");
});

test("empty input and wrong formats are actionable", () => {
  for (const input of ["", "target,off_target\nAAA,CCC", cas.replaceAll("\t", ","), "Id\tBulge type\tcrRNA\tDNA\tChromosome\tLocation\tDirection\tMismatches\tBulge Size"]) {
    assert.equal(previewToolImport(input, opts).canApply, false);
  }
});

test("placeholder guide PAM needs actual matching guide and never uses candidate PAM", () => {
  assert.equal(previewToolImport(cas, { ...opts, guide23: undefined }).canApply, false);
  assert.equal(previewToolImport(cas, { ...opts, guide23: "A".repeat(20) + "NGG" }).canApply, false);
  assert.equal(previewToolImport(cas, { ...opts, guide23: "C" + seq.slice(1) }).canApply, false);
  assert.equal(previewToolImport(cas.replace("NNN", "TNN"), opts).canApply, false);
});

test("actual 23nt guide from source is retained rather than overridden", () => {
  const result = previewToolImport(cas.replace("NNN", "TGG"), opts);
  assert.equal(result.rows[0].target, "A".repeat(20) + "TGG");
});

test("gaps, candidate PAM placeholders and truncated sequences block whole apply", () => {
  for (const candidate of ["A".repeat(19) + "-AGG", "A".repeat(20) + "NGG", "A".repeat(20), "A".repeat(20) + "UGG"]) {
    const input = cas.replace("AAAAAAAAAAAAAAAAAAAcAGG", candidate);
    const result = previewToolImport(cas + input, opts);
    assert.equal(result.inputRows, 2);
    assert.equal(result.rows.length, 1);
    assert.equal(result.canApply, false);
    assert.equal(result.csv, "");
  }
});

test("duplicate rows remain separate and are counted", () => {
  const result = previewToolImport(cas + cas, opts);
  assert.equal(result.rows.length, 2);
  assert.notEqual(result.rows[0].id, result.rows[1].id);
  assert.match(result.warnings.join(" "), /1 duplicate candidate/);
});

test("quoted source identifiers survive normalized CSV", () => {
  const input = chop.replace("synthetic-site", '"source,with,commas"');
  const result = previewToolImport(input, chopOpts);
  assert.equal(result.rows[0].source_id, "source,with,commas");
  assert.match(result.csv, /"source,with,commas"/);
});

test("bounds and malformed tables are rejected", () => {
  assert.equal(previewToolImport(cas.repeat(60_001), opts).canApply, false);
  assert.equal(previewToolImport("A".repeat(5 * 1024 * 1024 + 1), opts).canApply, false);
  assert.equal(previewToolImport(chop.replace("Strand", "Target sequence"), chopOpts).canApply, false);
  assert.equal(previewToolImport(chop + '"unterminated', chopOpts).canApply, false);
  assert.equal(previewToolImport(cas.replace("\t100\t", "\t-1\t"), opts).canApply, false);
  assert.equal(previewToolImport(cas.replace("\t+\t", "\t16\t"), opts).canApply, false);
});

test("normalized provenance cannot silently push the table past the request limit", () => {
  const sourceId = "s".repeat(200), guideId = "g".repeat(200);
  const input = `id\tguideId\tguideSeq\tofftargetSeq\tchrom\tstart\tend\tstrand\n` + `${sourceId}\t${guideId}\t${seq}\t${seq}\tchr1\t101\t123\t+\n`.repeat(10_000);
  assert.ok(new TextEncoder().encode(input).length < 5 * 1024 * 1024);
  const result = previewToolImport(input, { format: "crispor-offtargets", assembly: "GRCh38" });
  assert.equal(result.canApply, false);
  assert.equal(result.csv, "");
  assert.match(result.issues[0].message, /after adding provenance/);
});
