import type { Mode, ResultRow } from "../api";
import { guideKey, guideLabel } from "./resultIdentity.ts";

export interface OverviewFilters {
  guideKey: string;
  query: string;
  annotation: string;
  minMismatches: number | null;
  maxMismatches: number | null;
  includeUnknownMismatches: boolean;
  exactMatch: "all" | "hide" | "only";
}

/** A new object for each analysis; the initial view preserves every row. */
export function createOverviewFilters(): OverviewFilters {
  return {
    guideKey: "",
    query: "",
    annotation: "",
    minMismatches: null,
    maxMismatches: null,
    includeUnknownMismatches: true,
    exactMatch: "all",
  };
}

export interface RowCounts {
  total: number;
  mismatches: number[];
  unknownMismatches: number;
  exactMatches: number;
  unknownExactMatches: number;
  annotated: number;
  unavailable: number;
  noCoordinates: number;
  categories: Map<string, number>;
}

export interface GuideSummary extends RowCounts {
  key: string;
  id?: string;
  sequence: string;
  label: string;
}

export interface OverviewSummary extends RowCounts {
  guides: GuideSummary[];
}

/** Substitutions in the 20-base protospacer only; N is unknown, not a match. */
export function protospacerMismatches(row: ResultRow): number | null {
  const guide = row.target.slice(0, 20).toUpperCase();
  const candidate = row.off_target.slice(0, 20).toUpperCase();
  if (!/^[ACGT]{20}$/.test(guide) || !/^[ACGT]{20}$/.test(candidate))
    return null;
  let mismatches = 0;
  for (let index = 0; index < 20; index++)
    if (guide[index] !== candidate[index]) mismatches++;
  return mismatches;
}

/** Full 23-base identity, including PAM. This does not identify an on-target locus. */
export function exactSequenceMatch(row: ResultRow): boolean | null {
  const guide = row.target.toUpperCase();
  const candidate = row.off_target.toUpperCase();
  if (!/^[ACGT]{23}$/.test(guide) || !/^[ACGT]{23}$/.test(candidate))
    return null;
  return guide === candidate;
}

function emptyCounts(): RowCounts {
  return {
    total: 0,
    mismatches: Array<number>(21).fill(0),
    unknownMismatches: 0,
    exactMatches: 0,
    unknownExactMatches: 0,
    annotated: 0,
    unavailable: 0,
    noCoordinates: 0,
    categories: new Map(),
  };
}

function addRow(
  counts: RowCounts,
  row: ResultRow,
  mismatches: number | null,
  exact: boolean | null,
  categories: Set<string>,
) {
  counts.total++;
  if (mismatches === null) counts.unknownMismatches++;
  else counts.mismatches[mismatches]++;
  if (exact === true) counts.exactMatches++;
  if (exact === null) counts.unknownExactMatches++;
  if (row.annotations?.status === "annotated") {
    counts.annotated++;
    for (const category of categories)
      counts.categories.set(
        category,
        (counts.categories.get(category) ?? 0) + 1,
      );
  } else if (row.annotations?.status === "no_coordinates") {
    counts.noCoordinates++;
  } else {
    counts.unavailable++;
  }
}

/** One pass over the complete document, preserving duplicate rows and guide IDs. */
export function summarizeOverview(rows: readonly ResultRow[], submittedGuides?: unknown): OverviewSummary {
  const totals = emptyCounts();
  const guides = new Map<string, GuideSummary>();
  if (Array.isArray(submittedGuides)) {
    for (const guide of submittedGuides) {
      if (!guide || typeof guide.id !== "string" || typeof guide.target !== "string") continue;
      const row: ResultRow = { id: guide.id, guide_id: guide.id, target: guide.target, off_target: guide.target, scores: {} };
      const key = guideKey(row);
      guides.set(key, { ...emptyCounts(), key, id: guide.id, sequence: guide.target, label: guideLabel(row) });
    }
  }
  for (const row of rows) {
    const key = guideKey(row);
    let guide = guides.get(key);
    if (!guide) {
      guide = {
        ...emptyCounts(),
        key,
        id: row.guide_id,
        sequence: row.target,
        label: guideLabel(row),
      };
      guides.set(key, guide);
    }
    const mismatches = protospacerMismatches(row);
    const exact = exactSequenceMatch(row);
    const categories = new Set(row.annotations?.categories ?? []);
    addRow(totals, row, mismatches, exact, categories);
    addRow(guide, row, mismatches, exact, categories);
  }
  return { ...totals, guides: [...guides.values()] };
}

function matchesQuery(row: ResultRow, query: string): boolean {
  const values = [
    String(row.id),
    row.guide_id ?? "",
    row.target,
    row.off_target,
    row.chromosome ?? "",
    String(row.start ?? row.position ?? ""),
    row.assembly ?? "",
  ];
  if (values.some((value) => value.toLocaleLowerCase().includes(query)))
    return true;
  return (row.annotations?.features ?? []).some((feature) =>
    [feature.gene_id, feature.gene_name, feature.transcript_id ?? ""].some(
      (value) => value.toLocaleLowerCase().includes(query),
    ),
  );
}

/** Filters never sort or deduplicate rows; unknown counts remain visible by default. */
export function filterOverviewRows(
  rows: readonly ResultRow[],
  filters: OverviewFilters,
): ResultRow[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.guideKey && guideKey(row) !== filters.guideKey) return false;
    if (query && !matchesQuery(row, query)) return false;
    const status = row.annotations?.status ?? "unavailable";
    if (
      filters.annotation.startsWith("status:") &&
      status !== filters.annotation.slice(7)
    )
      return false;
    if (
      filters.annotation.startsWith("category:") &&
      (status !== "annotated" ||
        !row.annotations?.categories.includes(filters.annotation.slice(9)))
    )
      return false;
    const count = protospacerMismatches(row);
    if (count === null) {
      if (!filters.includeUnknownMismatches) return false;
    } else if (
      (filters.minMismatches !== null && count < filters.minMismatches) ||
      (filters.maxMismatches !== null && count > filters.maxMismatches)
    )
      return false;
    if (filters.exactMatch !== "all") {
      const exact = exactSequenceMatch(row);
      if (filters.exactMatch === "only" && exact !== true) return false;
      if (filters.exactMatch === "hide" && exact === true) return false;
    }
    return true;
  });
}

export function countRowsByGuide(
  rows: readonly ResultRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = guideKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function annotationCategoryLabel(category: string): string {
  return category.replace(/_/g, " ");
}

/** Show recorded search boundaries without implying an exhaustive biological search. */
export function overviewScope(
  mode: Mode,
  metadata: Record<string, unknown>,
): string {
  if (mode === "pairs")
    return "Provided candidate list. Genomic completeness is unknown; counts describe these rows only.";
  const reference =
    metadata.reference && typeof metadata.reference === "object"
      ? (metadata.reference as Record<string, unknown>)
      : {};
  const assembly = reference.assembly ?? reference.id ?? metadata.assembly;
  const parts = [
    typeof assembly === "string" ? assembly : "Reference not recorded",
  ];
  if (typeof reference.pam === "string") parts.push(`${reference.pam} PAM`);
  if (typeof metadata.max_mismatches === "number")
    parts.push(`up to ${metadata.max_mismatches} protospacer mismatches`);
  if (reference.bulges === false) parts.push("no bulges");
  return `Recorded search scope: ${parts.join(" · ")}. Counts describe returned candidates within this scope.`;
}
