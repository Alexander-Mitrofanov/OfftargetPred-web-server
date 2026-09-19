# 09 — Genome-browser links and BED export

## Integration

- Render `GenomicLinks({ row: ResultRow })` in a result row or selected-candidate view. It includes a 1-based, closed coordinate label, links, unavailable reasons, and the external-navigation disclosure.
- Call `buildBed(rows: ResultRow[])` from an explicit download action. Pass the complete analysis document or a clearly labelled selected/filtered subset.
- The return shape is `{ text, exported, skipped }`. Each skipped entry has `index` (0-based position in the passed array), optional original `row_index`, sanitized `id`, machine-readable `code`, and user-facing `reason`. **Show the exported/skipped counts and skipped reasons** beside the download; do not silently discard them.
- An empty eligible set returns `text: ""` and `exported: 0`. The caller should show the reasons instead of offering an empty BED download.
- The helper is pure and does not trigger a download, fetch, browser navigation, or UI state changes. Worker 13 can reuse it for report exports.

## Behavior and constraints

`buildGenomeLinks(row)` returns `{ locus, links, unavailable }`;
`validateGenomicLocus(row)` returns either `{ ok: true, locus }` or
`{ ok: false, code, reason }`.

Both browser links and BED require explicit `assembly: "GRCh38"`, a supported
0-based half-open coordinate convention, safe integer `start`/`end`, exactly
23 bases including PAM, a recorded `+` or `-` strand, and a verified primary
assembly contig. The interval must fit the known contig length. Neither a legacy
`position` nor sequence length fills in missing coordinates. Unsupported data
produce reasons rather than an invented locus.

The bundled allowlist contains the 194 Ensembl GRCh38 primary assembly regions
and their lengths (3,099,750,718 bases total). Canonical aliases are explicitly
`1`–`22`, `X`, `Y`, `MT` ↔ `chr1`–`chr22`, `chrX`, `chrY`, `chrM`.
Both canonical spellings are accepted; no generic `chr` stripping or prefixing
is used. Verified noncanonical contigs link to Ensembl only. Their exact names
remain in BED, and the UI explains why no UCSC alias is provided. Alternate
haplotypes, patches, unverified names, and arbitrary contig strings are rejected.

Browser URLs use `start + 1` and `end` on either strand. They contain only the
validated locus and the fixed assembly selection. Ordinary user-clicked anchors
use `target="_blank"`, `rel="noreferrer noopener"`, and
`referrerPolicy="no-referrer"`. There is no network prefetch or automatic
external sequence submission, and no ID, guide sequence, job token, or credential
field is included in these URLs.

BED is plain BED6 with tab-delimited columns and a final newline. It uses the
original 0-based half-open interval and recorded strand, explicit canonical UCSC
names (including `chrM`), and exact Ensembl names for other verified contigs.
Score is always neutral `0`; model scores are not rescaled or conflated.
Names contain original stable `row_index` when valid, sanitized guide ID and
result ID; a source-array index is the fallback when `row_index` is absent.
Colliding names receive deterministic suffixes, so identical coordinates and
duplicate IDs across guides never collapse. Names are bounded ASCII identifiers
with a fixed non-formula prefix. Tabs, newlines, controls, punctuation, and
formula syntax cannot create extra BED columns or rows. Sequence-like IDs are
redacted; raw target/off-target sequences are never used as name fallbacks.
There are no `track`/`browser` directives, HTML, or credentials in the export.
Preserve the original JSON/CSV alongside BED to retain the complete unsanitized
identity and scientific metadata; BED6 does not contain an assembly column.

## Verified sources

- [UCSC linking FAQ](https://genome.ucsc.edu/FAQ/FAQlink.html): `db` and `position` parameters.
- [UCSC BED specification](https://genome.ucsc.edu/FAQ/FAQformat.html#format1): zero-based starts, excluded end, and BED6 fields.
- [UCSC hg38 chromosome aliases](https://hgdownload.soe.ucsc.edu/goldenPath/hg38/bigZips/hg38.chromAlias.txt): canonical names, including `MT`/`chrM`.
- [Ensembl linking documentation](https://grch37.ensembl.org/info/docs/webcode/linking.html): the documented `/Homo_sapiens/Location/View?r=seq_region:start-end` form. The documentation mirror is used only as a reference; links target the current GRCh38 browser at `www.ensembl.org`.
- [Ensembl BED documentation](https://grch37.ensembl.org/info/website/upload/bed.html): BED fields and zero-based starts. [Ensembl coordinate conversion](https://beta.ensembl.org/help/articles/accessing-ensembl-s-refget-services): Ensembl uses one-based closed intervals; conversion to zero-based half-open subtracts one only from the start.
- [Ensembl assembly API documentation](https://rest.ensembl.org/documentation/info/assembly_info) and [verified public GRCh38 regions](https://rest.ensembl.org/info/assembly/homo_sapiens?content-type=application/json), retrieved 2026-09-19. Assembly is `GRCh38.p14`, default coordinate version `GRCh38`, accession `GCA_000001405.29`. Response SHA-256: `10783338fb7cfdc581daac143bec63e8ab5283efdbb40e56273e00072feeacbb`. This metadata fetch was development-only; application runtime uses the bundled list.

## Files and validation

- `frontend/src/features/genomeLinks.ts`
- `frontend/src/components/GenomicLinks.tsx`
- `frontend/src/components/GenomicLinks.css`
- `tests/frontend/genomeLinks.test.ts`

`node --experimental-strip-types tests/frontend/genomeLinks.test.ts` passes all
10 tests. Fixtures cover both strands, first-base and contig-end intervals,
MT/chrM, unplaced/unlocalized contigs, unknown assemblies, missing convention,
unsafe numbers, absent/invalid strand, URL/control injection, sanitized names,
duplicates across guides, empty/mixed exports, privacy fields, and 50,000 identical
rows. Imports use `.ts` extensions for Node 22 strip-types compatibility. Local
execution used Node 24.18.0. `npm run build` passes TypeScript and Vite checks.
Component server-rendering QA also passed: two protected canonical links, one
Ensembl-only noncanonical link, an explicit missing-strand reason, no sequence or
credential disclosure, and zero network requests while rendering.

Shared `App.tsx`, `api.ts`, manifests, and download integration are coordinator-owned
and were not edited by this worker.
