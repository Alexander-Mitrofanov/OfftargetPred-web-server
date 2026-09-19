import type { ResolvedGuideLocus } from "../components/GuideResolver";

export interface DiscoveryDocument {
  guides: ResolvedGuideLocus[];
  assembly: "GRCh38";
  reference_sha256: string;
  scope: { chromosome: string; start: number; end: number; complete: true; ambiguous_windows_skipped: number };
}
export interface GeneLocus {
  chromosome: string; start: number; end: number; strand: "+" | "-";
  feature: "gene" | "transcript"; gene_id: string; gene_name: string;
  transcript_id?: string; requires_narrowing: boolean;
}
export interface GeneDocument {
  query: string; matches: GeneLocus[]; status: "not_found" | "unique" | "ambiguous";
  complete: true; annotation: { source: string; release: string; assembly: "GRCh38" };
}

/** Human input is always 1-based inclusive; API intervals are 0-based half-open. */
export function discoveryInterval(chromosome: string, first: string, last: string) {
  if (!chromosome.trim() || chromosome.trim().length > 200) throw new Error("Enter a GRCh38 chromosome or exact reference contig.");
  const start = Number(first), end = Number(last);
  if (!/^\d+$/.test(first) || !/^\d+$/.test(last) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 1 || end - start + 1 < 23 || end - start + 1 > 20_000) {
    throw new Error("Enter a 1-based inclusive interval of 23–20,000 bases. Narrow a large gene or transcript to a region of interest.");
  }
  return { chromosome: chromosome.trim(), start: start - 1, end, assembly: "GRCh38" as const };
}

export function validateDiscoveryDocument(value: DiscoveryDocument): DiscoveryDocument {
  if (!value || value.assembly !== "GRCh38" || !value.scope?.complete || !Array.isArray(value.guides)
      || value.guides.length > 200 || !/^[a-f0-9]{64}$/.test(value.reference_sha256)
      || !Number.isSafeInteger(value.scope.start) || !Number.isSafeInteger(value.scope.end)
      || value.scope.start < 0 || value.scope.end - value.scope.start < 23 || value.scope.end - value.scope.start > 20_000
      || value.guides.some((guide) => !guide || !/^[ACGT]{21}GG$/.test(guide.target23)
        || !Number.isSafeInteger(guide.start) || guide.end !== guide.start + 23
        || guide.start < value.scope.start || guide.end > value.scope.end
        || guide.chromosome !== value.scope.chromosome || !["+", "-"].includes(guide.strand)
        || guide.assembly !== "GRCh38" || guide.reference_sha256 !== value.reference_sha256
        || guide.pam !== guide.target23.slice(20))) {
    throw new Error("Guide discovery did not return a complete, compatible reference interval. Please retry.");
  }
  return value;
}

export function validateGeneDocument(value: GeneDocument): GeneDocument {
  if (!value || !value.complete || !Array.isArray(value.matches) || value.matches.length > 25
      || value.annotation?.assembly !== "GRCh38"
      || value.matches.some((locus) => !locus || !locus.chromosome || !locus.gene_id
        || !Number.isSafeInteger(locus.start) || !Number.isSafeInteger(locus.end)
        || locus.start < 0 || locus.end <= locus.start || !["+", "-"].includes(locus.strand)
        || !["gene", "transcript"].includes(locus.feature))) {
    throw new Error("Gene lookup did not return a complete GRCh38 annotation response. Please retry.");
  }
  return value;
}
