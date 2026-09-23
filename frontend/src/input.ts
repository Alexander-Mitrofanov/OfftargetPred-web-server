import type { Capabilities, Mode, Submission } from "./api";

export const exampleGuide = "GATGCTCTCCAGAATCACTGCGG";
export const exampleSites =
  "GTTGCTCTTCAGAATCACTGAGG\nGCTGCCCTCCAGGATCACTGGGG\nGATGCTCTCCAGAATCACTGCGG";
export const exampleTable =
  "ID,target,off_target\nexample-1,GATGCTCTCCAGAATCACTGCGG,GTTGCTCTTCAGAATCACTGAGG\nexample-2,GATGCTCTCCAGAATCACTGCGG,GCTGCCCTCCAGGATCACTGGGG\nexample-3,GTCCCCTCCACCCCACAGTGGGG,GTCCCCTCCACCCCACAATGGGG";
export const exampleFasta = ">example-guide\nGATGCTCTCCAGAATCACTGCGG";
const guides = [
  "target",
  "sgRNA",
  "Guide_sequence",
  "AlignedTarget",
  "guide_sequence",
];
const sites = [
  "off_target",
  "offtarget",
  "Target_sequence",
  "AlignedText",
  "candidate_sequence",
];
export interface Validation {
  errors: string[];
  warnings: string[];
  rows: number;
  guideCount: number;
  normalized: string;
  format: Submission["format"];
}

export function parseTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    endedQuote = false;
  const clean = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        endedQuote = true;
      } else cell += char;
    } else if (char === '"') {
      if (cell || endedQuote)
        throw new Error(
          "Unexpected quotation mark. Use standard CSV quoting around a complete field.",
        );
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
      endedQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      endedQuote = false;
    } else {
      if (endedQuote) {
        if (!/\s/.test(char))
          throw new Error("Unexpected text after a quoted field.");
      } else cell += char;
    }
  }
  if (quoted)
    throw new Error(
      "A quoted CSV field is missing its closing quotation mark.",
    );
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
function sequenceError(value: string): string | null {
  if (value.length !== 23)
    return `has ${value.length} bases; exactly 23 are required, including the 3-base PAM`;
  if (!/^[ACGTN]+$/i.test(value))
    return "contains unsupported characters; use DNA bases A, C, G, T or N, without gaps";
  return null;
}
function warnUnknown(sequences: string[], result: Validation) {
  if (sequences.some((sequence) => /n/i.test(sequence)))
    result.warnings.push(
      "Some sequences contain N. These positions become unknown model tokens; interpret their scores with extra care.",
    );
}
export function validateInput(
  mode: Mode,
  inputMode: "single" | "table",
  guide: string,
  candidates: string,
  table: string,
  genome: string,
  capabilities: Capabilities | null,
): Validation {
  const result: Validation = {
    errors: [],
    warnings: [],
    rows: 0,
    guideCount: 0,
    normalized: "",
    format: "csv",
  };
  const maxPairs = capabilities?.limits.pairs ?? 60000;
  const maxGuides = capabilities?.limits.guides ?? 10;
  if (mode === "genome") {
    const entries: { id: string; sequence: string }[] = [];
    const text = genome.trim();
    if (!text) {
      result.errors.push(
        "Enter at least one guide sequence, including its PAM.",
      );
      return result;
    }
    if (text.startsWith(">")) {
      for (const line of text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)) {
        if (line.startsWith(">"))
          entries.push({ id: line.slice(1).trim(), sequence: "" });
        else if (entries.length) entries[entries.length - 1].sequence += line;
      }
    } else
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((sequence, index) =>
          entries.push({ id: `guide-${index + 1}`, sequence }),
        );
    entries.forEach((entry, i) => {
      const error = sequenceError(entry.sequence);
      if (error) result.errors.push(`Guide ${i + 1} ${error}.`);
      else if (!/^[ACGT]{20}[ACGT]GG$/i.test(entry.sequence))
        result.errors.push(
          `Guide ${i + 1}: genome search requires unambiguous DNA and an NGG PAM.`,
        );
      if (!entry.id)
        result.errors.push(`Guide ${i + 1} needs a FASTA identifier after >.`);
    });
    if (entries.length > maxGuides)
      result.errors.push(`Use at most ${maxGuides} guides per genome search.`);
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      result.errors.push("Each guide needs a unique identifier.");
    result.rows = entries.length;
    result.guideCount = entries.length;
    result.normalized = entries
      .map((entry) => `>${entry.id}\n${entry.sequence.toUpperCase()}`)
      .join("\n");
    result.format = "fasta";
  } else if (inputMode === "single") {
    const normalizedGuide = guide.trim().toUpperCase();
    const rows = candidates
      .split(/\r?\n/)
      .map((sequence) => sequence.trim().toUpperCase())
      .filter(Boolean);
    const error = sequenceError(normalizedGuide);
    if (error) result.errors.push(`Guide ${error}.`);
    if (!rows.length)
      result.errors.push(
        "Enter at least one candidate site, one sequence per line.",
      );
    rows.forEach((sequence, i) => {
      const rowError = sequenceError(sequence);
      if (rowError) result.errors.push(`Candidate ${i + 1} ${rowError}.`);
    });
    result.rows = rows.length;
    result.guideCount = normalizedGuide ? 1 : 0;
    result.normalized =
      "ID,target,off_target\n" +
      rows
        .map((sequence, i) => `site-${i + 1},${normalizedGuide},${sequence}`)
        .join("\n");
    warnUnknown([normalizedGuide, ...rows], result);
    if (normalizedGuide.length === 23 && !/GG$/.test(normalizedGuide))
      result.warnings.push(
        "The guide-associated PAM is not NGG. This differs from the guide PAMs in the supplied training set.",
      );
  } else {
    if (!table.trim()) {
      result.errors.push(
        "Paste or upload a CSV or TSV table of sequence pairs.",
      );
      return result;
    }
    const delimiter = table.split(/\r?\n/)[0].includes("\t") ? "\t" : ",";
    result.format = delimiter === "\t" ? "tsv" : "csv";
    try {
      const [header, ...rows] = parseTable(table, delimiter);
      if (!header) throw new Error("The input table is empty.");
      const normalizedHeader = header.map((value) => value.trim());
      const guideColumns = normalizedHeader
        .map((name, index) => (guides.includes(name) ? index : -1))
        .filter((index) => index >= 0);
      const siteColumns = normalizedHeader
        .map((name, index) => (sites.includes(name) ? index : -1))
        .filter((index) => index >= 0);
      if (guideColumns.length !== 1 || siteColumns.length !== 1)
        throw new Error(
          "Include one guide column (target) and one candidate column (off_target). Use only one accepted alias for each.",
        );
      if (new Set(normalizedHeader).size !== normalizedHeader.length)
        throw new Error("Column names must be unique.");
      const sequences: string[] = [],
        uniqueGuides = new Set<string>();
      rows.forEach((row, i) => {
        if (row.length !== header.length)
          result.errors.push(
            `Data row ${i + 1} has ${row.length} fields; the header has ${header.length}.`,
          );
        const target = (row[guideColumns[0]] ?? "").trim().toUpperCase();
        const site = (row[siteColumns[0]] ?? "").trim().toUpperCase();
        const guideError = sequenceError(target),
          siteError = sequenceError(site);
        if (guideError)
          result.errors.push(`Data row ${i + 1}, guide ${guideError}.`);
        if (siteError)
          result.errors.push(`Data row ${i + 1}, candidate ${siteError}.`);
        uniqueGuides.add(target);
        sequences.push(target, site);
      });
      if (!rows.length)
        result.errors.push("The table has a header but no candidate rows.");
      result.rows = rows.length;
      result.guideCount = uniqueGuides.size;
      result.normalized = table.trim();
      warnUnknown(sequences, result);
      if (
        [...uniqueGuides].some(
          (sequence) => sequence.length === 23 && !/GG$/.test(sequence),
        )
      )
        result.warnings.push(
          "Some guide-associated PAMs are not NGG. These differ from the guide PAMs in the supplied training set.",
        );
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "The table could not be read.",
      );
    }
  }
  if (mode === "pairs" && result.rows > maxPairs)
    result.errors.push(
      `The pair limit is ${maxPairs.toLocaleString()} rows. Split this table into smaller jobs.`,
    );
  return result;
}
