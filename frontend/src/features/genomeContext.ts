import type { AnnotationFeature, ResultRow } from "../api.ts";
import { GRCH38_CONTIG_LENGTHS, validateGenomicLocus } from "./genomeLinks.ts";
import type { GenomicLocus } from "./genomeLinks.ts";

export const CONTEXT_FLANKS = [100, 1_000, 10_000] as const;
export const CONTEXT_DRAW_LIMIT = 12;
export interface LocatedCandidate { index: number; row: ResultRow; locus: GenomicLocus }
export interface ContextIndex {
  located: LocatedCandidate[];
  skipped: { index: number; reason: string }[];
}
export interface ContextWindow { chromosome: string; start: number; end: number }
export interface CandidateSite {
  key: string;
  locus: GenomicLocus;
  candidates: LocatedCandidate[];
}
export interface ContextFeature {
  key: string;
  feature: AnnotationFeature;
  copies: number;
}
export interface ContextSnapshot {
  focal: LocatedCandidate;
  window: ContextWindow;
  nearby: LocatedCandidate[];
  sites: CandidateSite[];
  drawnSites: CandidateSite[];
  features: ContextFeature[];
  drawnFeatures: ContextFeature[];
  invalidFeatures: number;
  annotationStatus: "annotated" | "unavailable" | "no_coordinates";
  annotationSource: string;
  annotationReason: string;
  annotationTruncated: boolean;
}

/** No assembly or coordinate convention is inferred from a sequence. */
export function indexContextRows(rows: ResultRow[]): ContextIndex {
  const located: LocatedCandidate[] = [], skipped: ContextIndex["skipped"] = [];
  rows.forEach((row, index) => {
    const checked = validateGenomicLocus(row);
    if (checked.ok) located.push({ index, row, locus: checked.locus });
    else skipped.push({ index, reason: checked.reason });
  });
  return { located, skipped };
}

export function contextWindow(locus: GenomicLocus, flank: number): ContextWindow {
  if (!CONTEXT_FLANKS.some(value => value === flank)) throw new Error("Choose a supported context window.");
  return {
    chromosome: locus.chromosome,
    start: Math.max(0, locus.start - flank),
    end: Math.min(GRCH38_CONTIG_LENGTHS[locus.chromosome], locus.end + flank),
  };
}

/** Half-open intervals that touch at one boundary do not overlap. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Position within the visible window, clipped to [0, 1]. */
export function contextFraction(position: number, window: ContextWindow): number {
  if (!Number.isFinite(position) || window.end <= window.start) return 0;
  return Math.max(0, Math.min(1, (position - window.start) / (window.end - window.start)));
}

export function featureLabel(feature: AnnotationFeature): string {
  return feature.feature === "intron" ? "intron (inferred exon gap)" : feature.feature;
}

function validFeature(feature: AnnotationFeature, focal: LocatedCandidate): boolean {
  return !!feature && typeof feature.gene_id === "string" && typeof feature.feature === "string"
    && Number.isSafeInteger(feature.start) && Number.isSafeInteger(feature.end)
    && feature.start >= 0 && feature.end > feature.start
    && feature.end <= GRCH38_CONTIG_LENGTHS[focal.locus.chromosome]
    && (feature.strand === "+" || feature.strand === "-")
    && intervalsOverlap(feature.start, feature.end, focal.locus.start, focal.locus.end);
}

/**
 * Nearby candidates use all full-result rows. Features use only focal-row
 * annotations: these are site overlaps, never a comprehensive regional track.
 * Duplicate candidate rows remain in nearby; only identical rendered sites and
 * annotation features are grouped, with explicit copy counts.
 */
export function buildContext(index: ContextIndex, focalIndex: number, flank = 1_000): ContextSnapshot | null {
  const focal = index.located.find(candidate => candidate.index === focalIndex);
  if (!focal) return null;
  const window = contextWindow(focal.locus, flank);
  const nearby = index.located.filter(candidate => candidate.locus.chromosome === window.chromosome
    && intervalsOverlap(candidate.locus.start, candidate.locus.end, window.start, window.end))
    .sort((a, b) => a.locus.start - b.locus.start || a.locus.end - b.locus.end || a.index - b.index);
  const bySite = new Map<string, CandidateSite>();
  for (const candidate of nearby) {
    const { locus } = candidate;
    const key = JSON.stringify([locus.chromosome, locus.start, locus.end, locus.strand]);
    const site = bySite.get(key);
    if (site) site.candidates.push(candidate);
    else bySite.set(key, { key, locus, candidates: [candidate] });
  }
  const sites = [...bySite.values()];
  const distance = (site: CandidateSite) => Math.abs(site.locus.start - focal.locus.start);
  const drawnSites = [...sites].sort((a, b) => distance(a) - distance(b)
    || Number(b.locus.strand === focal.locus.strand) - Number(a.locus.strand === focal.locus.strand)
    || a.candidates[0].index - b.candidates[0].index)
    .slice(0, CONTEXT_DRAW_LIMIT).sort((a, b) => a.locus.start - b.locus.start || a.candidates[0].index - b.candidates[0].index);
  const annotation = focal.row.annotations;
  const annotationStatus = annotation?.status ?? "unavailable";
  const annotationData = annotation as unknown as Record<string, unknown> | undefined;
  const rawFeatures = annotationStatus === "annotated" && Array.isArray(annotation?.features) ? annotation.features : [];
  const byFeature = new Map<string, ContextFeature>();
  let invalidFeatures = 0;
  for (const feature of rawFeatures) {
    if (!validFeature(feature, focal)) { invalidFeatures++; continue; }
    const key = JSON.stringify([feature.gene_id, feature.gene_name, feature.transcript_id ?? "", feature.feature, feature.start, feature.end, feature.strand]);
    const existing = byFeature.get(key);
    if (existing) existing.copies++;
    else byFeature.set(key, { key, feature, copies: 1 });
  }
  const order = ["gene", "transcript", "exon", "CDS", "UTR", "intron"];
  const priority = (feature: AnnotationFeature) => { const i = order.indexOf(feature.feature); return i < 0 ? order.length : i; };
  const features = [...byFeature.values()].sort((a, b) => priority(a.feature) - priority(b.feature)
    || a.feature.start - b.feature.start || a.feature.gene_id.localeCompare(b.feature.gene_id)
    || (a.feature.transcript_id ?? "").localeCompare(b.feature.transcript_id ?? ""));
  return {
    focal, window, nearby, sites, drawnSites, features, drawnFeatures: features.slice(0, CONTEXT_DRAW_LIMIT), invalidFeatures,
    annotationStatus,
    annotationSource: annotation?.source ? [annotation.source, annotation.release].filter(Boolean).join(" ") : "Source not recorded",
    annotationReason: annotation?.reason ?? (annotationStatus !== "annotated" ? "Compatible site annotations are unavailable." : ""),
    annotationTruncated: annotationData?.truncated === true || annotationData?.features_truncated === true,
  };
}

export function contextCandidateLabel(candidate: LocatedCandidate): string {
  const { row, locus, index } = candidate;
  return `Row ${index + 1}: ${row.id}${row.guide_id ? ` · ${row.guide_id}` : ""} · ${locus.chromosome}:${locus.start + 1}–${locus.end} (${locus.strand})`;
}

export function findContextCandidates(index: ContextIndex, query: string, selectedRows?: ResultRow[]): LocatedCandidate[] {
  const selected = selectedRows ? new Set(selectedRows) : null;
  const term = query.trim().toLocaleLowerCase();
  return index.located.filter(candidate => (!selected || selected.has(candidate.row))
    && (!term || contextCandidateLabel(candidate).toLocaleLowerCase().includes(term)));
}
