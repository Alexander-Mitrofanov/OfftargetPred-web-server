# Import candidates from another tool

The importer converts supported plain-text exports locally in your browser. It
does not contact the source tool or submit a prediction job. Select a format,
provide any missing guide information, explicitly confirm GRCh38, then **Preview
import**. **Apply normalized pairs** fills the input table; review it and submit
the job separately.

Every pair needs a 20-nt DNA spacer followed by its **actual three-base PAM**.
For example, `AGG` is an actual PAM; `NGG` and `NNN` are motifs/placeholders.
The importer never substitutes a candidate's PAM for the guide's PAM. Supply the
actual 23-nt guide if the source has a 20-mer or PAM placeholders. For multiple
guides, provide full guide sequences per row or import each guide separately.

An error blocks the entire import. Unsupported rows are counted and shown;
duplicates remain separate rows. The preview displays up to five valid pairs and
the first twelve errors. Limits are 10,000 input pairs and 5 MiB. Gaps, bulges,
RNA bases, ambiguous candidate bases and missing PAMs are rejected.

## Supported variants

| Format | Required fields | Coordinate treatment |
| --- | --- | --- |
| Cas-OFFinder 2.4.1 | Headerless six-column TSV: query, chromosome, position, candidate, strand, mismatch count | Position is the 0-based start of the complete 23-nt site; end = start + 23. Candidate is already guide-oriented. |
| CRISPOR bulk off-target export | TSV or CSV headers `guideId`, `guideSeq`, `offtargetSeq`, `chrom`, `start`, `end`, `strand`; optional `seqId`, `id` | This export uses 1-based inclusive start/end. Subtract one from start; end is unchanged. Sequences are already guide-oriented. |
| CHOPCHOP-compatible enriched candidate table | TSV or CSV headers `Target sequence`, `Genomic location`, `Strand`; optional `Guide sequence`, `PAM`, `guide_id`, `id`/`ID` | Explicitly declare 0-based half-open or 1-based inclusive coordinates and candidate orientation. Location is `chromosome:start` or `chromosome:start-end` for the full 23-nt site. |

These are intentionally specific variants. Different versions, renamed columns,
BED files, spreadsheets and other formats should use the generic column mapper
after preparing full sequence pairs and explicit coordinate metadata.

### Cas-OFFinder

The [official 2.4.1 documentation](https://github.com/snugel/cas-offinder/blob/2.4.1/README.md)
defines the six fields and 0-based positions. Lowercase mismatch bases are
converted to uppercase. A negative strand does not trigger another reverse
complement. Newer nine-column output with bulge fields is a different format and
is rejected.

Synthetic format example, with fictitious coordinates and **no biological
validation meaning** (tabs between columns):

```text
AAAAAAAAAAAAAAAAAAAANNN	chr1	100	AAAAAAAAAAAAAAAAAAAcAGG	+	1
```

For this example the missing actual guide can be supplied as
`AAAAAAAAAAAAAAAAAAAAAGG`. A real analysis must use the actual guide-associated
PAM from the experiment or a reference-resolved locus.

### CRISPOR

CRISPOR's bulk exporter writes complete guide/candidate sequences. Its
`annotateOfftargets` routine constructs `start + 1, end` display coordinates;
`iterOfftargetRows` parses those values into the bulk table. This adapter converts
the resulting inclusive start back to zero-based. See the [pinned official
exporter](https://github.com/maximilianh/crisporWebsite/blob/486659fb3594f57fa108698a5f2a1f3ae649968c/crispor.py#L5653)
and [coordinate construction](https://github.com/maximilianh/crisporWebsite/blob/486659fb3594f57fa108698a5f2a1f3ae649968c/crispor.py#L1964).

The optional `seqId` is included in normalized guide identity, avoiding collisions
between guides from separate source sequences. Original score columns are not
treated as CRISPert scores. Source filtering and omitted repetitive candidates
are not recovered by import. An export containing omission notices must be
reviewed and reformatted explicitly before import.

Synthetic example (tabs between columns; fictitious coordinates):

```text
guideId	guideSeq	offtargetSeq	chrom	start	end	strand
laboratory-demo	AAAAAAAAAAAAAAAAAAAAAGG	AAAAAAAAAAAAAAAAAAACAGG	chr1	101	123	-
```

The normalized interval is `[100, 123)`, with the supplied negative strand and
candidate sequence unchanged.

### CHOPCHOP

The native guide ranking table reports guide sequences and counts of off-targets;
those counts are not individual candidates. The native `.offtargets` and
`offtargetsTable.csv` outputs do not provide each candidate's strand. In the
[official source](https://github.com/JokingHero/chopchop/blob/a5638846852368ceb524241261fcfcf774942edf/chopchop.py#L276),
`Hit.asOffTargetString` exports candidate location and sequence without its strand;
the [table writer](https://github.com/JokingHero/chopchop/blob/a5638846852368ceb524241261fcfcf774942edf/chopchop.py#L1615)
adds the **guide's** strand, which is not a substitute for candidate strand.

Accordingly, this adapter accepts a **manually enriched candidate table**, not an
unmodified native CHOPCHOP off-target download. Add the actual candidate strand
from the original alignment or reference. Declare the coordinate and sequence
conventions explicitly. Forward-reference negative-strand sequences are reverse
complemented only after this declaration. A separate `PAM` may complete a 20-nt
candidate only when that candidate is already guide-oriented. A guide ranking
table containing MM0–MM3 columns is rejected. See the [official CHOPCHOP
instructions](https://chopchop.cbu.uib.no/instructions) for its output views.

Synthetic enriched table (fictitious coordinates):

```csv
id,Guide sequence,Target sequence,Genomic location,Strand
synthetic-site,AAAAAAAAAAAAAAAAAAAAAGG,AAAAAAAAAAAAAAAAAAACAGG,chr1:101-123,+
```

Declare **1-based inclusive** and **guide-oriented** for this example.

## Provenance and annotation limits

Normalized rows carry `source_tool`, `source_format`, `source_id`, `guide_id`, a
new unique input `id`, and explicit GRCh38, chromosome, start, end, strand and
`coordinate_system` fields. Coordinates always cover all 23 bases, including the
PAM, in forward-reference coordinates. Source identifiers and duplicate rows are
retained; the prediction pipeline assigns stable `row_index` values.

These are **user-supplied, not reference-verified** loci. Syntax validation cannot
establish that the supplied candidate sequence occurs at the declared position.
Annotations describe that declared locus. The backend changes only known
canonical aliases (`chr1`–`chr22`, `chrX`, `chrY`, `chrM`) to Ensembl names and
retains the original in `source_chromosome`. Other contig names are unchanged;
unsupported contigs may have no annotation.

For any generic pair CSV, coordinate metadata must be complete: `assembly`,
`chromosome`, `start`, `end`, `strand`, `coordinate_system`. Use `GRCh38`, `+`/`-`,
`0-based half-open`, and `end - start = 23`. Remove all locus fields to score
sequences without coordinates. Partially specified loci are rejected. Imported
metadata cannot supply server scores, annotations, baseline scores, experimental
evidence, reference-verification claims or an intended/on-target status.

Implementation and synthetic regression fixtures are in
`frontend/src/features/toolImports.ts`, `tests/frontend/toolImports.test.ts`,
`backend/offtargetpred/input_metadata.py` and `tests/test_input_metadata.py`.
Upstream formats were checked on 2026-09-19; no private assay data are included.
