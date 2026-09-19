import assert from "node:assert/strict";
import { test } from "node:test";
import { discoveryInterval, validateDiscoveryDocument, validateGeneDocument } from "../../frontend/src/features/guideDiscovery.ts";

test("human coordinates become exact half-open API coordinates", () => {
  assert.deepEqual(discoveryInterval(" chr1 ", "11", "33"), { chromosome: "chr1", start: 10, end: 33, assembly: "GRCh38" });
  for (const [start, end] of [["0", "23"], ["1", "22"], ["1", "20001"], ["1e2", "200"], ["1.0", "23"], ["-1", "22"]]) {
    assert.throws(() => discoveryInterval("1", start, end));
  }
  assert.throws(() => discoveryInterval("", "1", "23"));
});

function response() {
  const hash = "a".repeat(64);
  return { assembly: "GRCh38" as const, reference_sha256: hash,
    scope: { chromosome: "1", start: 10, end: 33, complete: true as const, ambiguous_windows_skipped: 0 },
    guides: [{ chromosome: "1", start: 10, end: 33, spacer_start: 10, spacer_end: 30, strand: "+" as const,
      target23: "GACTACGATCGTAGCTACGTAGG", pam: "AGG", assembly: "GRCh38" as const,
      coordinate_system: "0-based half-open, forward-reference coordinates", reference_sha256: hash }] };
}

test("discovery verifies full sites, reference identity and response completeness", () => {
  assert.equal(validateDiscoveryDocument(response()).guides.length, 1);
  for (const change of [{ target23: "GACTACGATCGTAGCTACGTNGG" }, { end: 34 }, { start: 9 }, { pam: "TGG" }, { reference_sha256: "b".repeat(64) }, { chromosome: "2" }]) {
    const document = response();
    Object.assign(document.guides[0], change);
    assert.throws(() => validateDiscoveryDocument(document));
  }
  const partial = response();
  Object.assign(partial.scope, { complete: false });
  assert.throws(() => validateDiscoveryDocument(partial));
  const oversize = response();
  oversize.guides = Array.from({ length: 201 }, () => ({ ...oversize.guides[0] }));
  assert.throws(() => validateDiscoveryDocument(oversize));
});

test("empty complete interval is valid and distinct from incomplete results", () => {
  const empty = response(); empty.guides = [];
  assert.equal(validateDiscoveryDocument(empty).guides.length, 0);
});

test("gene response preserves all ambiguous loci without selecting one", () => {
  const document = { query: "DUP", complete: true as const, status: "ambiguous" as const,
    annotation: { source: "Ensembl", release: "115", assembly: "GRCh38" as const },
    matches: [0, 100].map((start) => ({ chromosome: "1", start, end: start + 50, strand: "+" as const,
      feature: "gene" as const, gene_id: `ENSG${start}`, gene_name: "DUP", requires_narrowing: false })) };
  assert.equal(validateGeneDocument(document).matches.length, 2);
  document.matches[1].start = -1;
  assert.throws(() => validateGeneDocument(document));
});
