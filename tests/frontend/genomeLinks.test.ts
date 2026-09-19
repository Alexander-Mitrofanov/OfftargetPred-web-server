import assert from "node:assert/strict";
import test from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import {
  buildBed,
  buildGenomeLinks,
  GRCH38_CONTIG_LENGTHS,
  validateGenomicLocus,
} from "../../frontend/src/features/genomeLinks.ts";

const sequence = "ACGTACGTACGTACGTACGTAGG";
const row = (patch: Partial<ResultRow> = {}): ResultRow => ({
  id: "candidate-1",
  row_index: 0,
  guide_id: "guide-1",
  target: sequence,
  off_target: sequence,
  scores: { k1: 0.93, k2: 0.32 },
  assembly: "GRCh38",
  chromosome: "1",
  start: 0,
  end: 23,
  coordinate_system: "0-based half-open",
  strand: "+",
  ...patch,
});
const fields = (text: string) =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => line.split("\t"));

test("both strands use start+1/end in browsers and unchanged BED intervals including PAM", () => {
  for (const strand of ["+", "-"]) {
    const candidate = row({ start: 100, end: 123, strand });
    const result = buildGenomeLinks(candidate);
    assert.equal(result.locus?.displayStart, 101);
    assert.equal(result.locus?.displayEnd, 123);
    assert.equal(result.locus?.strand, strand);
    const ensembl = new URL(result.links[0].href);
    assert.equal(ensembl.origin, "https://www.ensembl.org");
    assert.equal(ensembl.pathname, "/Homo_sapiens/Location/View");
    assert.deepEqual([...ensembl.searchParams], [["r", "1:101-123"]]);
    const ucsc = new URL(result.links[1].href);
    assert.equal(ucsc.origin, "https://genome.ucsc.edu");
    assert.equal(ucsc.pathname, "/cgi-bin/hgTracks");
    assert.deepEqual(
      [...ucsc.searchParams],
      [
        ["db", "hg38"],
        ["position", "chr1:101-123"],
      ],
    );
    const bed = buildBed([candidate]);
    assert.equal(bed.exported, 1);
    assert.deepEqual(bed.skipped, []);
    assert.deepEqual(fields(bed.text)[0], [
      "chr1",
      "100",
      "123",
      "row_0__guide_guide-1__id_candidate-1",
      "0",
      strand,
    ]);
    assert.ok(bed.text.endsWith("\n"));
  }
});

test("canonical Ensembl and UCSC aliases are explicit, including MT/chrM", () => {
  const names = [
    ...Array.from({ length: 22 }, (_, i) => String(i + 1)),
    "X",
    "Y",
    "MT",
  ];
  for (const name of names) {
    const ucsc = name === "MT" ? "chrM" : `chr${name}`;
    for (const chromosome of [name, ucsc]) {
      const result = buildGenomeLinks(row({ chromosome }));
      assert.equal(result.locus?.chromosome, name);
      assert.equal(result.locus?.ucscChromosome, ucsc);
      assert.equal(
        new URL(result.links[0].href).searchParams.get("r"),
        `${name}:1-23`,
      );
      assert.equal(fields(buildBed([row({ chromosome })]).text)[0][0], ucsc);
    }
  }
  for (const chromosome of ["M", "chrMT", "CHR1", "chr01", "01", "chr23"]) {
    assert.equal(validateGenomicLocus(row({ chromosome })).ok, false);
  }
});

test("verified contig bounds permit end-touching sites and reject overflow on either strand", () => {
  assert.equal(Object.keys(GRCH38_CONTIG_LENGTHS).length, 194);
  assert.equal(
    Object.values(GRCH38_CONTIG_LENGTHS).reduce((sum, n) => sum + n, 0),
    3_099_750_718,
  );
  for (const chromosome of ["1", "MT", "KI270728.1", "KI270442.1"]) {
    const end = GRCH38_CONTIG_LENGTHS[chromosome];
    for (const strand of ["+", "-"]) {
      const candidate = row({ chromosome, strand, start: end - 23, end });
      assert.equal(buildBed([candidate]).exported, 1);
      assert.equal(buildGenomeLinks(candidate).locus?.displayEnd, end);
      const invalid = buildBed([
        { ...candidate, start: end - 22, end: end + 1 },
      ]);
      assert.equal(invalid.exported, 0);
      assert.equal(invalid.skipped[0].code, "out_of_bounds");
    }
  }
});

test("verified noncanonical contigs link only to Ensembl and keep exact BED names", () => {
  for (const chromosome of ["KI270442.1", "KI270728.1", "GL000220.1"]) {
    const candidate = row({ chromosome });
    const result = buildGenomeLinks(candidate);
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].browser, "Ensembl");
    assert.equal(
      new URL(result.links[0].href).searchParams.get("r"),
      `${chromosome}:1-23`,
    );
    assert.equal(result.unavailable[0].browser, "UCSC");
    assert.match(result.unavailable[0].reason, /No verified UCSC alias/);
    assert.equal(fields(buildBed([candidate]).text)[0][0], chromosome);
  }
});

test("unverified names and URL/control injection never produce a browser link or BED locus", () => {
  for (const chromosome of [
    "KI999999.1",
    "KI270442.2",
    "chrKI270442.1",
    "chrUn_KI270442v1",
    "https://evil.example/x",
    "1;r=2:1-23",
    "1&token=private",
    "1#token=private",
    "1\t0\t23",
    "1\ntrack name=evil",
    "1\u0000",
    " 1",
    "1 ",
    "__proto__",
    "constructor",
    "toString",
    "",
    ["1"] as unknown as string,
    { toString: "1" } as unknown as string,
  ]) {
    const candidate = row({ chromosome });
    assert.deepEqual(buildGenomeLinks(candidate).links, []);
    const bed = buildBed([candidate]);
    assert.equal(bed.text, "");
    assert.equal(bed.skipped[0].code, "unverified_contig");
  }
});

test("unknown assembly, convention, missing strand, and unsafe coordinates produce explicit reasons", () => {
  const cases: [Partial<ResultRow>, string][] = [
    [{ assembly: undefined }, "missing_assembly"],
    [{ assembly: "GRCh37" }, "unsupported_assembly"],
    [{ assembly: "hg38" }, "unsupported_assembly"],
    [{ coordinate_system: undefined }, "unsupported_coordinate_system"],
    [{ coordinate_system: "1-based closed" }, "unsupported_coordinate_system"],
    [{ start: undefined, position: 0 }, "missing_coordinates"],
    [{ end: undefined }, "missing_coordinates"],
    [{ start: -1, end: 22 }, "invalid_coordinates"],
    [{ start: 0.5, end: 23.5 }, "invalid_coordinates"],
    [{ start: Number.NaN }, "invalid_coordinates"],
    [{ end: Number.POSITIVE_INFINITY }, "invalid_coordinates"],
    [
      { start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER + 23 },
      "invalid_coordinates",
    ],
    [{ start: "0" as unknown as number }, "invalid_coordinates"],
    [{ start: true as unknown as number }, "invalid_coordinates"],
    [{ end: 0 }, "invalid_coordinates"],
    [{ start: 23, end: 0 }, "invalid_coordinates"],
    [{ end: 20 }, "invalid_site_length"],
    [{ strand: undefined }, "missing_strand"],
    [{ strand: "." }, "invalid_strand"],
    [{ strand: "1" }, "invalid_strand"],
  ];
  const candidates = cases.map(([patch], index) =>
    row({ ...patch, row_index: index }),
  );
  const bed = buildBed(candidates);
  assert.equal(bed.exported, 0);
  assert.equal(bed.text, "");
  assert.equal(bed.skipped.length, candidates.length);
  for (const [index, skipped] of bed.skipped.entries()) {
    assert.equal(skipped.index, index);
    assert.equal(skipped.row_index, index);
    assert.equal(skipped.code, cases[index][1]);
    assert.ok(skipped.reason.length > 20);
    const browser = buildGenomeLinks(candidates[index]);
    assert.equal(browser.locus, null);
    assert.deepEqual(browser.links, []);
    assert.equal(browser.unavailable[0].reason, skipped.reason);
  }
  assert.equal(
    buildBed([
      row({
        coordinate_system: "0-based half-open, forward-reference coordinates",
      }),
    ]).exported,
    1,
  );
});

test("BED retains duplicate coordinates and IDs across guides with stable row identity", () => {
  const candidates = [
    row({ row_index: 40 }),
    row({ row_index: 41, guide_id: "guide-2" }),
    row({ row_index: 42 }),
    row({ row_index: 42 }),
    row({ row_index: undefined }),
    row({ row_index: undefined }),
  ];
  const first = buildBed(candidates);
  assert.deepEqual(buildBed(candidates), first);
  assert.equal(first.exported, candidates.length);
  const names = fields(first.text).map((line) => line[3]);
  assert.equal(new Set(names).size, candidates.length);
  assert.match(names[0], /^row_40__guide_guide-1__/);
  assert.match(names[1], /^row_41__guide_guide-2__/);
  assert.equal(fields(buildBed([candidates[1]]).text)[0][3], names[1]);
  assert.match(names[4], /^input_4__/);
  assert.equal(
    new Set(fields(first.text).map((line) => line.slice(0, 3).join("\t"))).size,
    1,
  );
});

test("BED names are bounded, sanitize controls and formula prefixes, and exclude sequence fallbacks and credentials", () => {
  const credential = "private-job-secret-token";
  const candidate = {
    ...row({
      id: '=HYPERLINK("x")\t\r\n\u0000\u202e',
      guide_id: "@SUM(A1)\t\n",
    }),
    token: credential,
    job_id: credential,
    credentials: { token: credential },
  };
  const rows = [
    candidate,
    row({ id: sequence, guide_id: undefined }),
    row({ id: "x".repeat(500), guide_id: "y".repeat(500) }),
  ];
  const result = buildBed(rows);
  for (const line of fields(result.text)) {
    assert.equal(line.length, 6);
    assert.match(line[3], /^[A-Za-z0-9_.-]+$/);
    assert.ok(line[3].length < 255);
    assert.match(line[3], /^(row|input)_/);
    assert.equal(line[4], "0");
  }
  assert.ok(!result.text.includes(sequence));
  assert.ok(!result.text.includes(credential));
  for (const { href } of buildGenomeLinks(candidate).links) {
    assert.ok(!href.includes(credential));
    assert.ok(!href.includes(sequence));
    assert.ok(!href.includes("HYPERLINK"));
  }
});

test("empty exports and mixed eligible rows preserve exact exported/skipped counts", () => {
  assert.deepEqual(buildBed([]), { text: "", exported: 0, skipped: [] });
  const result = buildBed([
    row(),
    row({ assembly: "unknown", row_index: 9 }),
    row({ strand: "-", row_index: 12 }),
  ]);
  assert.equal(result.exported, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].index, 1);
  assert.equal(result.skipped[0].row_index, 9);
});

test("50,000 identical rows are all retained with distinct BED names", () => {
  const result = buildBed(Array.from({ length: 50_000 }, () => row()));
  assert.equal(result.exported, 50_000);
  assert.equal(result.skipped.length, 0);
  assert.equal(
    new Set(fields(result.text).map((line) => line[3])).size,
    50_000,
  );
});
