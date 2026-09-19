import assert from "node:assert/strict";
import test from "node:test";
import type { AnnotationFeature, ResultRow } from "../../frontend/src/api.ts";
import { GRCH38_CONTIG_LENGTHS } from "../../frontend/src/features/genomeLinks.ts";
import {
  buildContext, contextFraction, contextWindow, featureLabel, findContextCandidates,
  indexContextRows, intervalsOverlap,
} from "../../frontend/src/features/genomeContext.ts";

const sequence = "A".repeat(20) + "AGG";
const row = (patch: Partial<ResultRow> = {}): ResultRow => ({ id: "same-id", target: sequence, off_target: sequence,
  scores: { k1: .1 }, assembly: "GRCh38", coordinate_system: "0-based half-open", chromosome: "1", start: 1_000, end: 1_023, strand: "+", ...patch });
const feature = (patch: Partial<AnnotationFeature> = {}): AnnotationFeature => ({ gene_id: "ENSG1", gene_name: "GENE", transcript_id: "ENST1", feature: "exon", start: 999, end: 1_010, strand: "+", ...patch });

test("coordinate-only view rejects missing convention, strand, reference and invalid bounds", () => {
  const indexed = indexContextRows([row(), row({ assembly: undefined }), row({ coordinate_system: undefined }), row({ strand: "?" }), row({ end: 1_022 }), row({ start: -1, end: 22 }), row({ chromosome: "unknown" })]);
  assert.equal(indexed.located.length, 1);
  assert.equal(indexed.skipped.length, 6);
  assert.equal(indexed.located[0].locus.displayStart, 1_001);
  assert.equal(indexed.located[0].locus.displayEnd, 1_023);
});
test("window clips to contig edges on either strand and cannot select unbounded flanks", () => {
  const low = indexContextRows([row({ start: 0, end: 23, strand: "-" })]).located[0].locus;
  assert.deepEqual(contextWindow(low, 100), { chromosome: "1", start: 0, end: 123 });
  const length = GRCH38_CONTIG_LENGTHS.MT;
  const high = indexContextRows([row({ chromosome: "chrM", start: length - 23, end: length })]).located[0].locus;
  assert.deepEqual(contextWindow(high, 1_000), { chromosome: "MT", start: length - 1_023, end: length });
  assert.throws(() => contextWindow(low, Number.POSITIVE_INFINITY));
  assert.throws(() => contextWindow(low, -100));
});
test("half-open boundary touch is not an overlap; positions clip to visible window", () => {
  assert.equal(intervalsOverlap(0, 23, 23, 30), false);
  assert.equal(intervalsOverlap(0, 23, 22, 30), true);
  const window = { chromosome: "1", start: 100, end: 200 };
  assert.deepEqual([50, 100, 150, 200, 250].map(position => contextFraction(position, window)), [0, 0, .5, 1, 1]);
});
test("nearby includes all guides and duplicates, while identical interval/strand bars group", () => {
  const rows = [row(), row({ guide_id: "another" }), row({ strand: "-" }), row({ chromosome: "2" }), row({ start: 877, end: 900 }), row({ start: 878, end: 901 }), row({ start: 1_123, end: 1_146 })];
  const context = buildContext(indexContextRows(rows), 0, 100)!;
  assert.deepEqual(context.nearby.map(candidate => candidate.index), [5, 0, 1, 2]);
  assert.equal(context.sites.length, 3);
  assert.equal(context.sites.find(site => site.locus.start === 1_000 && site.locus.strand === "+")!.candidates.length, 2);
  assert.equal(context.focal.row, rows[0]);
});
test("diagram cap keeps focal site and nearest sites; full nearby rows remain available", () => {
  const rows = Array.from({ length: 40 }, (_, index) => row({ start: 1_000 + index * 25, end: 1_023 + index * 25 }));
  const context = buildContext(indexContextRows(rows), 20)!;
  assert.equal(context.nearby.length, 40);
  assert.equal(context.drawnSites.length, 12);
  assert.ok(context.drawnSites.some(site => site.candidates.some(candidate => candidate.index === 20)));
});
test("features only derive from focal row, preserve duplicates count, and label inferred introns", () => {
  const rows = [row({ annotations: { status: "annotated", categories: ["exon", "intron"], source: "Ensembl", release: "115", features: [feature(), feature(), feature({ feature: "intron", start: 1_010, end: 1_030 })] } }), row({ annotations: { status: "annotated", categories: ["gene"], features: [feature({ gene_id: "unrelated" })] } })];
  const context = buildContext(indexContextRows(rows), 0)!;
  assert.equal(context.features.length, 2);
  assert.equal(context.features[0].copies, 2);
  assert.equal(context.annotationSource, "Ensembl 115");
  assert.equal(featureLabel(context.features[1].feature), "intron (inferred exon gap)");
  assert.equal(context.features.some(item => item.feature.gene_id === "unrelated"), false);
});
test("invalid and non-overlapping feature records are explicitly counted", () => {
  const features = [feature(), feature({ start: -1 }), feature({ end: 999 }), feature({ start: 1_023, end: 1_030 }), feature({ strand: "." }), feature({ end: GRCH38_CONTIG_LENGTHS["1"] + 1 })];
  const context = buildContext(indexContextRows([row({ annotations: { status: "annotated", categories: [], features } })]), 0)!;
  assert.equal(context.features.length, 1);
  assert.equal(context.invalidFeatures, 5);
});
test("unavailable annotation never becomes intergenic or emits stale feature arrays", () => {
  const context = buildContext(indexContextRows([row({ annotations: { status: "unavailable", reason: "Index unavailable", categories: ["intergenic"], features: [feature()] } })]), 0)!;
  assert.equal(context.annotationStatus, "unavailable");
  assert.equal(context.features.length, 0);
  assert.equal(context.annotationReason, "Index unavailable");
});
test("upstream truncation and local diagram feature limits are distinct", () => {
  const annotations = { status: "annotated" as const, categories: ["exon"], features: Array.from({ length: 15 }, (_, index) => feature({ transcript_id: `ENST${index}` })), truncated: true };
  const context = buildContext(indexContextRows([row({ annotations })]), 0)!;
  assert.equal(context.annotationTruncated, true);
  assert.equal(context.features.length, 15);
  assert.equal(context.drawnFeatures.length, 12);
});
test("search and selection preserve exact row identities even with duplicate IDs", () => {
  const rows = [row(), row({ guide_id: "test-guide" }), row({ chromosome: "2" })], indexed = indexContextRows(rows);
  assert.deepEqual(findContextCandidates(indexed, "TEST-GUIDE").map(candidate => candidate.index), [1]);
  assert.deepEqual(findContextCandidates(indexed, "2:1001").map(candidate => candidate.index), [2]);
  assert.deepEqual(findContextCandidates(indexed, "", [rows[1]]).map(candidate => candidate.index), [1]);
  assert.deepEqual(findContextCandidates(indexed, "", []), []);
});
test("empty, no-coordinate and nonexistent focal results are harmless", () => {
  assert.equal(buildContext(indexContextRows([]), 0), null);
  assert.equal(buildContext(indexContextRows([row({ assembly: undefined })]), 0), null);
  assert.equal(buildContext(indexContextRows([row()]), 99), null);
});
