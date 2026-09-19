import type { ResultRow } from "../api";

/** Stable within a result document, including duplicate user-provided identifiers. */
export function candidateKey(row: ResultRow): string {
  return JSON.stringify([
    row.row_index ?? null,
    row.guide_id ?? row.target,
    row.id,
    row.chromosome ?? "",
    row.start ?? row.position ?? null,
    row.strand ?? "",
    row.off_target,
  ]);
}

export function guideKey(row: ResultRow): string {
  return JSON.stringify([row.guide_id ?? "", row.target]);
}

export function guideLabel(row: ResultRow): string {
  return row.guide_id ? `${row.guide_id} · ${row.target}` : row.target;
}
