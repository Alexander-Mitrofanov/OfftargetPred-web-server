import assert from "node:assert/strict";
import test from "node:test";
import { parseTable } from "../../frontend/src/input.ts";
import {
  guessColumns,
  inspectTable,
  mapColumns,
} from "../../frontend/src/features/columnMapping.ts";

const guide = "GATGCTCTCCAGAATCACTGCGG";
const candidate = "GTTGCTCTTCAGAATCACTGAGG";
const manual = { guide: 1, candidate: 2, id: 0 };

test("arbitrary headers require explicit columns; normalization only trims ends and uppercases DNA", () => {
  const table = inspectTable(
    `sample,first,second\nentry-1, ${guide.toLowerCase()} ,${candidate}`,
  );
  assert.deepEqual(guessColumns(table.headers), {
    guide: null,
    candidate: null,
    id: null,
  });
  assert.equal(mapColumns(table, guessColumns(table.headers)).valid, false);
  const result = mapColumns(table, manual);
  assert.equal(result.valid, true);
  assert.equal(
    result.normalizedCsv,
    `ID,target,off_target\nentry-1,${guide},${candidate}`,
  );
  assert.equal(result.totalRows, 1);
  assert.equal(result.invalidRows, 0);
});

test("known aliases are suggestions only, ambiguous aliases remain unselected", () => {
  assert.deepEqual(
    guessColumns(["ID", "Guide_sequence", "Target_sequence"]),
    manual,
  );
  assert.deepEqual(guessColumns(["target", "sgRNA", "off_target"]), {
    guide: null,
    candidate: 2,
    id: null,
  });
  assert.deepEqual(guessColumns(["id", "guide_id", "target", "off_target"]), {
    guide: 2,
    candidate: 3,
    id: null,
  });
});

test("sequence columns cannot be reused for guide/candidate/identifier and unknown indexes are rejected", () => {
  const table = inspectTable(`a,b\n${guide},${candidate}`);
  assert.match(
    mapColumns(table, { guide: 0, candidate: 0, id: null }).issues[0].message,
    /different columns/,
  );
  assert.equal(
    mapColumns(table, { guide: 0, candidate: 1, id: 1 }).valid,
    false,
  );
  assert.equal(
    mapColumns(table, { guide: -1, candidate: 1, id: null }).valid,
    false,
  );
  assert.equal(
    mapColumns(table, { guide: 0, candidate: 99, id: null }).valid,
    false,
  );
});

test("quoted CSV IDs, multiline metadata and literal coordinate fields survive unchanged", () => {
  const input = `sample,first,second,chromosome,start,end,strand,assembly,coordinate_system,comment\n"test, ""quoted""",${guide},${candidate}, chr1 ,000123,146,-,GRCh38,"0-based\nhalf-open",omit-me`;
  const result = mapColumns(inspectTable(input), manual);
  assert.equal(result.valid, true);
  const [header, row] = parseTable(result.normalizedCsv, ",");
  assert.deepEqual(header, [
    "ID",
    "target",
    "off_target",
    "chromosome",
    "start",
    "end",
    "strand",
    "assembly",
    "coordinate_system",
  ]);
  assert.deepEqual(row, [
    'test, "quoted"',
    guide,
    candidate,
    " chr1 ",
    "000123",
    "146",
    "-",
    "GRCh38",
    "0-based\nhalf-open",
  ]);
  assert.deepEqual(result.omittedColumns, ["comment"]);
});

test("CSV tabs inside a quoted header do not select TSV; explicit separator handles ambiguous headers", () => {
  const input = `"guide\tvalue",candidate\n${guide},${candidate}`;
  const table = inspectTable(input);
  assert.equal(table.delimiter, ",");
  assert.equal(
    mapColumns(table, { guide: 0, candidate: 1, id: null }).valid,
    true,
  );
  assert.equal(
    inspectTable(`g,c\tname\n${guide},${candidate}\trow`, {}, "csv").delimiter,
    ",",
  );
});

test("BOM and CRLF TSV input work, generated identifiers preserve row order", () => {
  const table = inspectTable(
    `\uFEFFtarget\toff_target\r\n${guide}\t${candidate}\r\n${guide}\t${guide}\r\n`,
  );
  assert.equal(table.delimiter, "\t");
  const result = mapColumns(table, guessColumns(table.headers));
  assert.equal(result.valid, true);
  assert.deepEqual(
    parseTable(result.normalizedCsv, ",")
      .slice(1)
      .map((row) => row[0]),
    ["pair-1", "pair-2"],
  );
});

test("duplicate and blank headers are blocking, including surrounding whitespace", () => {
  assert.match(
    inspectTable(`target, target\n${guide},${candidate}`).errors.join(" "),
    /unique/,
  );
  assert.match(
    inspectTable(`target,\n${guide},${candidate}`).errors.join(" "),
    /non-empty/,
  );
  assert.match(
    inspectTable("target,off_target").errors.join(" "),
    /no candidate rows/,
  );
});

test("malformed quotes are rejected before any normalized output is offered", () => {
  for (const input of [
    `target,off_target\n"${guide},${candidate}`,
    `target,off_target\n${guide}",${candidate}`,
    `target,off_target\n"${guide}"suffix,${candidate}`,
  ]) {
    const table = inspectTable(input);
    assert.equal(table.errors.length, 1);
    const result = mapColumns(table, { guide: 0, candidate: 1, id: null });
    assert.equal(result.valid, false);
    assert.equal(result.normalizedCsv, "");
  }
});

test("uneven field counts cannot be hidden by mapping or dropping extra columns", () => {
  const table = inspectTable(
    `target,off_target\n${guide},${candidate},unexpected\n${guide}`,
  );
  const result = mapColumns(table, { guide: 0, candidate: 1, id: null });
  assert.equal(result.valid, false);
  assert.equal(result.invalidRows, 2);
  assert.equal(
    result.issues.filter((issue) => /fields; the header/.test(issue.message))
      .length,
    2,
  );
});

test("all rows are validated even outside the first-10 preview", () => {
  const records = Array.from(
    { length: 12 },
    (_, index) =>
      `row-${index},${guide},${index === 11 ? candidate.slice(0, 20) : candidate}`,
  );
  const result = mapColumns(
    inspectTable(`id,target,off_target\n${records.join("\n")}`),
    manual,
  );
  assert.equal(result.totalRows, 12);
  assert.equal(result.preview.length, 10);
  assert.equal(result.invalidRows, 1);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.row),
    [12],
  );
  assert.match(result.issues[0].message, /including the 3-base PAM/);
});

test("missing PAMs, gaps, interior whitespace and RNA U stay invalid; no biological inference is made", () => {
  for (const value of [
    guide.slice(0, 20),
    `-${guide.slice(1)}`,
    `U${guide.slice(1)}`,
    `${guide.slice(0, 10)} ${guide.slice(11)}`,
  ]) {
    const result = mapColumns(
      inspectTable(`target,off_target\n${value},${candidate}`),
      { guide: 0, candidate: 1, id: null },
    );
    assert.equal(result.valid, false, value);
    assert.equal(result.normalizedCsv, "");
    assert.equal(result.preview[0].guide, value);
    assert.equal(result.preview[0].errors.length, 1);
  }
});

test("pair scoring allows N and non-NGG guide PAMs with visible warnings", () => {
  const value = `N${guide.slice(1, 20)}TGA`;
  const result = mapColumns(
    inspectTable(`target,off_target\n${value},${candidate}`),
    { guide: 0, candidate: 1, id: null },
  );
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.preview[0].warnings.length, 2);
  assert.equal(parseTable(result.normalizedCsv, ",")[1][1], value);
});

test("empty, overlong and non-printable identifiers are rejected; duplicate identifiers are preserved", () => {
  for (const identifier of ["", "x".repeat(201), '"a\nb"']) {
    const result = mapColumns(
      inspectTable(`id,target,off_target\n${identifier},${guide},${candidate}`),
      manual,
    );
    assert.equal(result.valid, false);
    assert.equal(result.invalidRows, 1);
  }
  const result = mapColumns(
    inspectTable(
      `id,target,off_target\na,${guide},${candidate}\na,${guide},${candidate}`,
    ),
    manual,
  );
  assert.equal(result.valid, true);
  assert.equal(result.totalRows, 2);
});

test("row bounds stop parsing early while quoted newlines remain one logical record", () => {
  const tooMany = inspectTable(
    `g,c\n${guide},${candidate}\n${guide},${candidate}`,
    { maxRows: 1 },
  );
  assert.match(tooMany.errors.join(" "), /at most 1 data rows/);
  assert.equal(tooMany.rows.length, 0);
  const quoted = inspectTable(
    `g,c,coordinate_system\n${guide},${candidate},"line1\nline2\nline3"`,
    { maxRows: 1 },
  );
  assert.equal(quoted.errors.length, 0);
  assert.equal(quoted.rows.length, 1);
});

test("input byte bounds count UTF-8 and normalized JSON encoding is bounded", () => {
  const unicode = inspectTable(`g,c\n${"é".repeat(60)},${candidate}`, {
    maxRequestBytes: 100,
  });
  assert.match(unicode.errors.join(" "), /100-byte/);
  const raw = `id,target,off_target,chromosome\n"${'""'.repeat(100)}",${guide},${candidate},chr1`;
  const table = inspectTable(raw, { maxRequestBytes: 600 });
  assert.equal(table.errors.length, 0);
  const result = mapColumns(table, manual, { maxRequestBytes: 600 });
  assert.equal(result.valid, false);
  assert.match(
    result.issues.map((issue) => issue.message).join(" "),
    /after JSON encoding/,
  );
});

test("60,000 rows remain complete and the hard supported pair cap cannot be lifted by props", () => {
  const raw = `target,off_target\n${Array.from({ length: 60_000 }, () => `${guide},${candidate}`).join("\n")}`;
  const result = mapColumns(inspectTable(raw), {
    guide: 0,
    candidate: 1,
    id: null,
  });
  assert.equal(result.valid, true);
  assert.equal(result.totalRows, 60_000);
  assert.equal(parseTable(result.normalizedCsv, ",").length, 60_001);
  const tooMany = inspectTable(`${raw}\n${guide},${candidate}`, {
    maxRows: 1_000_000,
  });
  assert.match(tooMany.errors.join(" "), /60,000 data rows/);
});

test("excessive column counts and long headers are bounded before rendering controls", () => {
  const many = inspectTable(
    Array.from({ length: 257 }, (_, index) => `column${index}`).join(",") +
      "\nx",
  );
  assert.match(many.errors.join(" "), /at most 256 columns/);
  assert.equal(many.headers.length, 0);
  assert.match(
    inspectTable(`${"header".repeat(40)},target\nx,${guide}`).errors.join(" "),
    /at most 200 characters/,
  );
});
