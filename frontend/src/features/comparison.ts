import type { ResultRow } from "../api";
import { candidateKey, guideKey, guideLabel } from "./resultIdentity.ts";

export type ComparisonModel = "k1" | "k2" | "k3" | "cfd";
export const comparisonModels: ComparisonModel[] = ["k1", "k2", "k3", "cfd"];
export const comparisonModelLabel: Record<ComparisonModel, string> = {
  k1: "CRISPert k=1", k2: "CRISPert k=2", k3: "CRISPert k=3", cfd: "CFD baseline",
};

export function comparisonScore(row: ResultRow, model: ComparisonModel): number | null {
  const value = model === "cfd" ? row.baselines?.cfd?.score : row.scores[model];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function comparisonGuides(rows: ResultRow[]) {
  const guides = new Map<string, { key: string; label: string; count: number }>();
  for (const row of rows) {
    const key = guideKey(row), found = guides.get(key);
    if (found) found.count++;
    else guides.set(key, { key, label: guideLabel(row), count: 1 });
  }
  return [...guides.values()];
}

export interface RankedCandidate {
  key: string;
  row: ResultRow;
  rank: number;
  firstRank: number;
  lastRank: number;
}

/** Descending independent ranks; exact score ties receive their average rank. */
export function rankCandidates(rows: ResultRow[], model: ComparisonModel): RankedCandidate[] {
  const scored = rows.flatMap(row => {
    const score = comparisonScore(row, model);
    return score === null ? [] : [{ row, key: candidateKey(row), score }];
  });
  scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const ranked: RankedCandidate[] = [];
  for (let first = 0; first < scored.length;) {
    let end = first + 1;
    while (end < scored.length && scored[end].score === scored[first].score) end++;
    for (let index = first; index < end; index++) {
      ranked.push({ key: scored[index].key, row: scored[index].row, rank: (first + 1 + end) / 2, firstRank: first + 1, lastRank: end });
    }
    first = end;
  }
  return ranked;
}

export interface RankCorrelation {
  value: number | null;
  n: number;
  reason?: "fewer_than_three_pairs" | "constant_ranks";
}

/** Spearman: rerank each model within the same jointly scored candidate subset. */
export function spearmanForRows(rows: ResultRow[], a: ComparisonModel, b: ComparisonModel): RankCorrelation {
  const joint = rows.filter(row => comparisonScore(row, a) !== null && comparisonScore(row, b) !== null);
  const n = joint.length;
  if (n < 3) return { value: null, n, reason: "fewer_than_three_pairs" };
  const rankA = rankCandidates(joint, a), rankB = new Map(rankCandidates(joint, b).map(entry => [entry.key, entry.rank]));
  const mean = (n + 1) / 2;
  let numerator = 0, squareA = 0, squareB = 0;
  for (const item of rankA) {
    const x = item.rank - mean, y = rankB.get(item.key)! - mean;
    numerator += x * y;
    squareA += x * x;
    squareB += y * y;
  }
  if (!squareA || !squareB) return { value: null, n, reason: "constant_ranks" };
  return { value: Math.max(-1, Math.min(1, numerator / Math.sqrt(squareA * squareB))), n };
}

export interface CandidateComparison {
  key: string;
  row: ResultRow;
  a: RankedCandidate | null;
  b: RankedCandidate | null;
  delta: number | null;
  topA: boolean;
  topB: boolean;
}

/** Always pass the complete document. Guide selection is required and explicit. */
export function compareGuide(rows: ResultRow[], selectedGuide: string, a: ComparisonModel, b: ComparisonModel, requestedTopN = 10) {
  const guideRows = selectedGuide ? rows.filter(row => guideKey(row) === selectedGuide) : [];
  const topN = Number.isFinite(requestedTopN) ? Math.max(1, Math.min(100, Math.floor(requestedTopN))) : 10;
  const ranksA = rankCandidates(guideRows, a), ranksB = rankCandidates(guideRows, b);
  const byA = new Map(ranksA.map(item => [item.key, item])), byB = new Map(ranksB.map(item => [item.key, item]));
  // Include every member of a tie spanning the Nth position; no arbitrary winners.
  const topA = new Set(ranksA.filter(item => item.firstRank <= topN).map(item => item.key));
  const topB = new Set(ranksB.filter(item => item.firstRank <= topN).map(item => item.key));
  const intersection = [...topA].filter(key => topB.has(key)).length;
  const candidates: CandidateComparison[] = guideRows.map(row => {
    const key = candidateKey(row), entryA = byA.get(key) ?? null, entryB = byB.get(key) ?? null;
    return { key, row, a: entryA, b: entryB, delta: entryA && entryB ? entryA.rank - entryB.rank : null, topA: topA.has(key), topB: topB.has(key) };
  });
  return {
    candidates,
    total: guideRows.length,
    scoredA: ranksA.length,
    scoredB: ranksB.length,
    missingA: guideRows.length - ranksA.length,
    missingB: guideRows.length - ranksB.length,
    tiedA: ranksA.filter(item => item.firstRank !== item.lastRank).length,
    tiedB: ranksB.filter(item => item.firstRank !== item.lastRank).length,
    topN,
    topCountA: topA.size,
    topCountB: topB.size,
    intersection,
    union: topA.size + topB.size - intersection,
    correlation: spearmanForRows(guideRows, a, b),
  };
}

export function comparisonTableRows(candidates: CandidateComparison[], view: "top" | "disagreement" | "all"): CandidateComparison[] {
  const selected = view === "top" ? candidates.filter(item => item.topA || item.topB) : [...candidates];
  return selected.sort((a, b) => {
    if (view === "disagreement") {
      if (a.delta === null) return b.delta === null ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : 1;
      if (b.delta === null) return -1;
      if (Math.abs(a.delta) !== Math.abs(b.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
    }
    const rankA = Math.min(a.a?.rank ?? Infinity, a.b?.rank ?? Infinity);
    const rankB = Math.min(b.a?.rank ?? Infinity, b.b?.rank ?? Infinity);
    return rankA - rankB || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
}
