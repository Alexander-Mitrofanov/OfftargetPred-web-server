import type { ResultRow } from "../api.ts";
import { comparisonModelLabel, comparisonScore, rankCandidates } from "./comparison.ts";
import type { ComparisonModel } from "./comparison.ts";
import { annotationCategoryLabel, protospacerMismatches } from "./overview.ts";
import { candidateKey, guideKey, guideLabel } from "./resultIdentity.ts";

export const MAX_SHORTLIST_PER_GROUP = 100;
export const MAX_AUTOMATIC_SHORTLIST = 5_000;
export type SelectionNotes = Record<string, string[]>;
export interface ShortlistRule {
  model: ComparisonModel;
  perGroup: number;
  includeTies: boolean;
  excludeIntended: boolean;
  stratify: "none" | "mismatches" | "annotation";
  guide: string;
}
export interface ShortlistGroup {
  guideKey: string;
  guideLabel: string;
  stratum: string;
  eligible: number;
  proposed: number;
  boundaryTie: number;
}
export interface ShortlistPlan {
  rule: ShortlistRule;
  keys: Set<string>;
  rows: ResultRow[];
  notes: SelectionNotes;
  groups: ShortlistGroup[];
  missingScores: number;
  excludedIntended: number;
  considered: number;
  blocked: boolean;
}

export function defaultShortlistRule(): ShortlistRule {
  return { model: "k1", perGroup: 10, includeTies: true, excludeIntended: false, stratify: "none", guide: "" };
}

function strata(row: ResultRow, rule: ShortlistRule): string[] {
  if (rule.stratify === "mismatches") {
    const value = protospacerMismatches(row);
    return [value === null ? "unknown protospacer mismatch count" : `${value} protospacer mismatch${value === 1 ? "" : "es"}`];
  }
  if (rule.stratify === "annotation") {
    if (row.annotations?.status === "no_coordinates") return ["no genomic coordinates"];
    if (row.annotations?.status !== "annotated") return ["annotation unavailable"];
    const categories = [...new Set(row.annotations.categories.filter(Boolean))];
    return categories.length ? categories.map(category => `annotation: ${annotationCategoryLabel(category)}`) : ["annotation category not recorded"];
  }
  return ["all candidates"];
}

/** Rank complete per-guide sets. Preview only: applying a plan is a separate explicit action. */
export function planShortlist(rows: ResultRow[], requested: ShortlistRule): ShortlistPlan {
  const rule = { ...requested, perGroup: Number.isFinite(requested.perGroup) ? Math.max(1, Math.min(MAX_SHORTLIST_PER_GROUP, Math.floor(requested.perGroup))) : 10 };
  const buckets = new Map<string, { guide: string; label: string; stratum: string; rows: ResultRow[] }>();
  let missingScores = 0, excludedIntended = 0, considered = 0;
  for (const row of rows) {
    const guide = guideKey(row);
    if (rule.guide && guide !== rule.guide) continue;
    considered++;
    if (rule.excludeIntended && row.user_selected_locus === true) { excludedIntended++; continue; }
    if (comparisonScore(row, rule.model) === null) { missingScores++; continue; }
    for (const stratum of strata(row, rule)) {
      const key = JSON.stringify([guide, stratum]);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { guide, label: guideLabel(row), stratum, rows: [] }; buckets.set(key, bucket); }
      bucket.rows.push(row);
    }
  }
  const keys = new Set<string>(), notes: SelectionNotes = {}, groups: ShortlistGroup[] = [];
  for (const bucket of buckets.values()) {
    const ranked = rankCandidates(bucket.rows, rule.model);
    const cutoff = ranked[Math.min(rule.perGroup, ranked.length) - 1];
    const boundaryTie = cutoff && cutoff.lastRank > rule.perGroup ? cutoff.lastRank - cutoff.firstRank + 1 : 0;
    const proposed = rule.includeTies ? ranked.filter(item => item.firstRank <= rule.perGroup) : ranked.slice(0, rule.perGroup);
    groups.push({ guideKey: bucket.guide, guideLabel: bucket.label, stratum: bucket.stratum, eligible: ranked.length, proposed: proposed.length, boundaryTie });
    for (const item of proposed) {
      keys.add(item.key);
      const note = `${comparisonModelLabel[rule.model]}: top ${rule.perGroup} for this guide${rule.stratify === "none" ? "" : ` within ${bucket.stratum}`}; rank ${item.rank}${item.firstRank === item.lastRank ? "" : ` (tied positions ${item.firstRank}–${item.lastRank})`}. ${rule.includeTies ? "All cutoff ties included." : "Cutoff ties ordered by stable row identity."}${rule.excludeIntended ? " User-designated intended loci excluded before ranking." : " Intended loci retained."}`;
      (notes[item.key] ??= []).push(note);
    }
  }
  return { rule, keys, rows: rows.filter(row => keys.has(candidateKey(row))), notes, groups, missingScores, excludedIntended, considered, blocked: keys.size > MAX_AUTOMATIC_SHORTLIST };
}

/** Automatic selection never removes existing choices unless the user chooses replace. */
export function applyShortlist(selected: ReadonlySet<string>, plan: ShortlistPlan, action: "add" | "replace"): Set<string> {
  if (plan.blocked) throw new Error(`Automatic proposals are limited to ${MAX_AUTOMATIC_SHORTLIST.toLocaleString()} candidates. Narrow the guide scope, reduce N or change the stratification.`);
  return new Set(action === "replace" ? plan.keys : [...selected, ...plan.keys]);
}

/** Preserve recorded rule reasons; externally selected rows are explicitly labelled manual. */
export function reconcileSelectionNotes(selected: ReadonlySet<string>, existing: SelectionNotes, added: SelectionNotes = {}): SelectionNotes {
  const result: SelectionNotes = {};
  for (const key of selected) {
    const reasons = [...new Set([...(existing[key] ?? []), ...(added[key] ?? [])])];
    result[key] = reasons.length ? reasons : ["Manually selected in the results table or model comparison."];
  }
  return result;
}

export function shortlistGuideSummary(rows: ResultRow[], selected: ReadonlySet<string>) {
  const guides = new Map<string, { key: string; label: string; available: number; selected: number }>();
  for (const row of rows) {
    const key = guideKey(row);
    let guide = guides.get(key);
    if (!guide) { guide = { key, label: guideLabel(row), available: 0, selected: 0 }; guides.set(key, guide); }
    guide.available++;
    if (selected.has(candidateKey(row))) guide.selected++;
  }
  return [...guides.values()];
}
