import type { ResultRow } from "../api.ts";

export type GenomeBrowser = "Ensembl" | "UCSC";
export type LocusIssueCode =
  | "missing_assembly"
  | "unsupported_assembly"
  | "unsupported_coordinate_system"
  | "missing_coordinates"
  | "invalid_coordinates"
  | "invalid_site_length"
  | "missing_strand"
  | "invalid_strand"
  | "unverified_contig"
  | "out_of_bounds";

export interface GenomicLocus {
  assembly: "GRCh38";
  /** Exact Ensembl primary-assembly identifier. */
  chromosome: string;
  /** Present only for the explicit canonical chromosome aliases below. */
  ucscChromosome?: string;
  start: number;
  end: number;
  displayStart: number;
  displayEnd: number;
  strand: "+" | "-";
}

export interface LocusIssue {
  code: LocusIssueCode;
  reason: string;
}

export interface GenomeLinksResult {
  locus: GenomicLocus | null;
  links: { browser: GenomeBrowser; href: string }[];
  unavailable: { browser: GenomeBrowser; reason: string }[];
}

export interface BedSkippedRow extends LocusIssue {
  /** Position in the array passed to buildBed, before any rows are skipped. */
  index: number;
  row_index?: number;
  /** A safe display identifier, never a sequence fallback. */
  id: string;
}

export interface BedExport {
  text: string;
  exported: number;
  skipped: BedSkippedRow[];
}

// Verified public Ensembl GRCh38 primary-assembly regions, fetched 2026-09-19.
// https://rest.ensembl.org/info/assembly/homo_sapiens?content-type=application/json
// 194 regions; sum(length) = 3,099,750,718. Exact allowlist, not a naming regex.
// Response SHA-256: 10783338fb7cfdc581daac143bec63e8ab5283efdbb40e56273e00072feeacbb
export const GRCH38_CONTIG_LENGTHS: Readonly<Record<string, number>> =
  Object.freeze({
    "1": 248956422,
    "10": 133797422,
    "11": 135086622,
    "12": 133275309,
    "13": 114364328,
    "14": 107043718,
    "15": 101991189,
    "16": 90338345,
    "17": 83257441,
    "18": 80373285,
    "19": 58617616,
    "2": 242193529,
    "20": 64444167,
    "21": 46709983,
    "22": 50818468,
    "3": 198295559,
    "4": 190214555,
    "5": 181538259,
    "6": 170805979,
    "7": 159345973,
    "8": 145138636,
    "9": 138394717,
    "GL000008.2": 209709,
    "GL000009.2": 201709,
    "GL000194.1": 191469,
    "GL000195.1": 182896,
    "GL000205.2": 185591,
    "GL000208.1": 92689,
    "GL000213.1": 164239,
    "GL000214.1": 137718,
    "GL000216.2": 176608,
    "GL000218.1": 161147,
    "GL000219.1": 179198,
    "GL000220.1": 161802,
    "GL000221.1": 155397,
    "GL000224.1": 179693,
    "GL000225.1": 211173,
    "GL000226.1": 15008,
    "KI270302.1": 2274,
    "KI270303.1": 1942,
    "KI270304.1": 2165,
    "KI270305.1": 1472,
    "KI270310.1": 1201,
    "KI270311.1": 12399,
    "KI270312.1": 998,
    "KI270315.1": 2276,
    "KI270316.1": 1444,
    "KI270317.1": 37690,
    "KI270320.1": 4416,
    "KI270322.1": 21476,
    "KI270329.1": 1040,
    "KI270330.1": 1652,
    "KI270333.1": 2699,
    "KI270334.1": 1368,
    "KI270335.1": 1048,
    "KI270336.1": 1026,
    "KI270337.1": 1121,
    "KI270338.1": 1428,
    "KI270340.1": 1428,
    "KI270362.1": 3530,
    "KI270363.1": 1803,
    "KI270364.1": 2855,
    "KI270366.1": 8320,
    "KI270371.1": 2805,
    "KI270372.1": 1650,
    "KI270373.1": 1451,
    "KI270374.1": 2656,
    "KI270375.1": 2378,
    "KI270376.1": 1136,
    "KI270378.1": 1048,
    "KI270379.1": 1045,
    "KI270381.1": 1930,
    "KI270382.1": 4215,
    "KI270383.1": 1750,
    "KI270384.1": 1658,
    "KI270385.1": 990,
    "KI270386.1": 1788,
    "KI270387.1": 1537,
    "KI270388.1": 1216,
    "KI270389.1": 1298,
    "KI270390.1": 2387,
    "KI270391.1": 1484,
    "KI270392.1": 971,
    "KI270393.1": 1308,
    "KI270394.1": 970,
    "KI270395.1": 1143,
    "KI270396.1": 1880,
    "KI270411.1": 2646,
    "KI270412.1": 1179,
    "KI270414.1": 2489,
    "KI270417.1": 2043,
    "KI270418.1": 2145,
    "KI270419.1": 1029,
    "KI270420.1": 2321,
    "KI270422.1": 1445,
    "KI270423.1": 981,
    "KI270424.1": 2140,
    "KI270425.1": 1884,
    "KI270429.1": 1361,
    "KI270435.1": 92983,
    "KI270438.1": 112505,
    "KI270442.1": 392061,
    "KI270448.1": 7992,
    "KI270465.1": 1774,
    "KI270466.1": 1233,
    "KI270467.1": 3920,
    "KI270468.1": 4055,
    "KI270507.1": 5353,
    "KI270508.1": 1951,
    "KI270509.1": 2318,
    "KI270510.1": 2415,
    "KI270511.1": 8127,
    "KI270512.1": 22689,
    "KI270515.1": 6361,
    "KI270516.1": 1300,
    "KI270517.1": 3253,
    "KI270518.1": 2186,
    "KI270519.1": 138126,
    "KI270521.1": 7642,
    "KI270522.1": 5674,
    "KI270528.1": 2983,
    "KI270529.1": 1899,
    "KI270530.1": 2168,
    "KI270538.1": 91309,
    "KI270539.1": 993,
    "KI270544.1": 1202,
    "KI270548.1": 1599,
    "KI270579.1": 31033,
    "KI270580.1": 1553,
    "KI270581.1": 7046,
    "KI270582.1": 6504,
    "KI270583.1": 1400,
    "KI270584.1": 4513,
    "KI270587.1": 2969,
    "KI270588.1": 6158,
    "KI270589.1": 44474,
    "KI270590.1": 4685,
    "KI270591.1": 5796,
    "KI270593.1": 3041,
    "KI270706.1": 175055,
    "KI270707.1": 32032,
    "KI270708.1": 127682,
    "KI270709.1": 66860,
    "KI270710.1": 40176,
    "KI270711.1": 42210,
    "KI270712.1": 176043,
    "KI270713.1": 40745,
    "KI270714.1": 41717,
    "KI270715.1": 161471,
    "KI270716.1": 153799,
    "KI270717.1": 40062,
    "KI270718.1": 38054,
    "KI270719.1": 176845,
    "KI270720.1": 39050,
    "KI270721.1": 100316,
    "KI270722.1": 194050,
    "KI270723.1": 38115,
    "KI270724.1": 39555,
    "KI270725.1": 172810,
    "KI270726.1": 43739,
    "KI270727.1": 448248,
    "KI270728.1": 1872759,
    "KI270729.1": 280839,
    "KI270730.1": 112551,
    "KI270731.1": 150754,
    "KI270732.1": 41543,
    "KI270733.1": 179772,
    "KI270734.1": 165050,
    "KI270735.1": 42811,
    "KI270736.1": 181920,
    "KI270737.1": 103838,
    "KI270738.1": 99375,
    "KI270739.1": 73985,
    "KI270740.1": 37240,
    "KI270741.1": 157432,
    "KI270742.1": 186739,
    "KI270743.1": 210658,
    "KI270744.1": 168472,
    "KI270745.1": 41891,
    "KI270746.1": 66486,
    "KI270747.1": 198735,
    "KI270748.1": 93321,
    "KI270749.1": 158759,
    "KI270750.1": 148850,
    "KI270751.1": 150742,
    "KI270752.1": 27745,
    "KI270753.1": 62944,
    "KI270754.1": 40191,
    "KI270755.1": 36723,
    "KI270756.1": 79590,
    "KI270757.1": 71251,
    MT: 16569,
    X: 156040895,
    Y: 57227415,
  });

const canonicalAliases = new Map<string, string>([
  ["1", "chr1"],
  ["2", "chr2"],
  ["3", "chr3"],
  ["4", "chr4"],
  ["5", "chr5"],
  ["6", "chr6"],
  ["7", "chr7"],
  ["8", "chr8"],
  ["9", "chr9"],
  ["10", "chr10"],
  ["11", "chr11"],
  ["12", "chr12"],
  ["13", "chr13"],
  ["14", "chr14"],
  ["15", "chr15"],
  ["16", "chr16"],
  ["17", "chr17"],
  ["18", "chr18"],
  ["19", "chr19"],
  ["20", "chr20"],
  ["21", "chr21"],
  ["22", "chr22"],
  ["X", "chrX"],
  ["Y", "chrY"],
  ["MT", "chrM"],
]);
const ensemblAliases = new Map(
  [...canonicalAliases].map(([ensembl, ucsc]) => [ucsc, ensembl]),
);
const coordinateSystems = new Set([
  "0-based half-open",
  "0-based half-open, forward-reference coordinates",
]);

/** Fail closed: do not infer assembly, strand, end, or coordinate convention. */
export function validateGenomicLocus(
  row: ResultRow,
): { ok: true; locus: GenomicLocus } | ({ ok: false } & LocusIssue) {
  if (!row.assembly) {
    return {
      ok: false,
      code: "missing_assembly",
      reason: "Assembly is missing; a GRCh38 locus cannot be established.",
    };
  }
  if (row.assembly !== "GRCh38") {
    return {
      ok: false,
      code: "unsupported_assembly",
      reason: "Only explicitly recorded GRCh38 coordinates are supported.",
    };
  }
  if (!coordinateSystems.has(row.coordinate_system ?? "")) {
    return {
      ok: false,
      code: "unsupported_coordinate_system",
      reason:
        "The coordinate convention must be explicitly recorded as 0-based, half-open.",
    };
  }
  const { start, end } = row;
  if (start == null || end == null) {
    return {
      ok: false,
      code: "missing_coordinates",
      reason:
        "Both the interval start and end are required; neither is inferred from a position or sequence.",
    };
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    return {
      ok: false,
      code: "invalid_coordinates",
      reason: "Coordinates must be safe whole numbers with 0 ≤ start < end.",
    };
  }
  if (end - start !== 23) {
    return {
      ok: false,
      code: "invalid_site_length",
      reason:
        "The interval must span the full 23-nt site, including its 3-nt PAM.",
    };
  }
  if (!row.strand) {
    return {
      ok: false,
      code: "missing_strand",
      reason: "Strand is missing; a + or − strand must be recorded.",
    };
  }
  if (row.strand !== "+" && row.strand !== "-") {
    return {
      ok: false,
      code: "invalid_strand",
      reason: "Strand is unrecognized; only + and - are supported.",
    };
  }
  const chromosome =
    typeof row.chromosome === "string"
      ? (ensemblAliases.get(row.chromosome) ?? row.chromosome)
      : undefined;
  if (!chromosome || !Object.hasOwn(GRCH38_CONTIG_LENGTHS, chromosome)) {
    return {
      ok: false,
      code: "unverified_contig",
      reason:
        "This contig name is not in the verified GRCh38 primary-assembly list.",
    };
  }
  if (end > GRCH38_CONTIG_LENGTHS[chromosome]) {
    return {
      ok: false,
      code: "out_of_bounds",
      reason: "The interval extends beyond the verified GRCh38 contig length.",
    };
  }
  return {
    ok: true,
    locus: {
      assembly: "GRCh38",
      chromosome,
      ucscChromosome: canonicalAliases.get(chromosome),
      start,
      end,
      displayStart: start + 1,
      displayEnd: end,
      strand: row.strand,
    },
  };
}

/** Pure URL construction; no request, prefetch, job token, ID, or sequence. */
export function buildGenomeLinks(row: ResultRow): GenomeLinksResult {
  const checked = validateGenomicLocus(row);
  if (!checked.ok) {
    return {
      locus: null,
      links: [],
      unavailable: ["Ensembl", "UCSC"].map((browser) => ({
        browser: browser as GenomeBrowser,
        reason: checked.reason,
      })),
    };
  }
  const { locus } = checked;
  const ensembl = new URL("https://www.ensembl.org/Homo_sapiens/Location/View");
  ensembl.searchParams.set(
    "r",
    `${locus.chromosome}:${locus.displayStart}-${locus.displayEnd}`,
  );
  const links: GenomeLinksResult["links"] = [
    { browser: "Ensembl", href: ensembl.href },
  ];
  const unavailable: GenomeLinksResult["unavailable"] = [];
  if (locus.ucscChromosome) {
    const ucsc = new URL("https://genome.ucsc.edu/cgi-bin/hgTracks");
    ucsc.searchParams.set("db", "hg38");
    ucsc.searchParams.set(
      "position",
      `${locus.ucscChromosome}:${locus.displayStart}-${locus.displayEnd}`,
    );
    links.push({ browser: "UCSC", href: ucsc.href });
  } else {
    unavailable.push({
      browser: "UCSC",
      reason:
        "No verified UCSC alias is provided for this noncanonical contig; its exact Ensembl name is retained.",
    });
  }
  return { locus, links, unavailable };
}

/** BED names contain only ASCII identifiers, never raw sequence fallbacks. */
function safeName(value: unknown, fallback: string): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const text = String(value);
  if (/^[ACGTRYSWKMBDHVNUacgtryswkmbdhvnu]{20,}$/.test(text))
    return "sequence-id";
  return text.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || fallback;
}

function validRowIndex(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * BED6, 0-based half-open forward-reference intervals, full site including PAM.
 * Canonical names use explicit UCSC aliases; other verified Ensembl names stay
 * unchanged. Score 0 is neutral, not a rescaling of uncalibrated model outputs.
 * Every input row is retained or gets an explicit skip reason. No deduplication.
 */
export function buildBed(rows: ResultRow[]): BedExport {
  const lines: string[] = [];
  const skipped: BedSkippedRow[] = [];
  const usedNames = new Set<string>();
  const nextCopy = new Map<string, number>();
  rows.forEach((row, index) => {
    const checked = validateGenomicLocus(row);
    if (!checked.ok) {
      skipped.push({
        index,
        row_index: validRowIndex(row.row_index) ? row.row_index : undefined,
        id: safeName(row.id, "unnamed"),
        code: checked.code,
        reason: checked.reason,
      });
      return;
    }
    const { locus } = checked;
    const identity = validRowIndex(row.row_index)
      ? `row_${row.row_index}`
      : `input_${index}`;
    const baseName = `${identity}__guide_${safeName(row.guide_id, "unlabelled")}__id_${safeName(row.id, "unnamed")}`;
    let name = baseName;
    let copy = nextCopy.get(baseName) ?? 1;
    while (usedNames.has(name)) name = `${baseName}__copy_${++copy}`;
    nextCopy.set(baseName, copy);
    usedNames.add(name);
    lines.push(
      [
        locus.ucscChromosome ?? locus.chromosome,
        locus.start,
        locus.end,
        name,
        0,
        locus.strand,
      ].join("\t"),
    );
  });
  return {
    text: lines.length ? `${lines.join("\n")}\n` : "",
    exported: lines.length,
    skipped,
  };
}
