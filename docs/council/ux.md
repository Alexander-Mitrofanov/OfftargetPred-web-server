# UX council: OfftargetPred web server

Date: 2026-09-19. Scope: read-only discovery and design recommendations before implementation.

## Evidence reviewed

- [CRISPRoff submission interface](https://rth.dk/resources/crispr/crisproff/)
- [CRISPRoff help](https://rth.dk/resources/crispr/crisproff/help)
- [CRISPRoff about/results interpretation](https://rth.dk/resources/crispr/crisproff/about)
- `Model/crispert_share/README.md`, `evaluate.py`, `crispert_small/data.py`, `crispert_small/tokenizer.py`, and example dataset headers.
- Frontend design skill at `/home/alex/.codex/skills/frontend-design/SKILL.md`.

CRISPRoff provides a direct research workflow: a submission form, sequence examples, genome selection, optional job details, and help. Its results organize guides and off-target candidates into tables, highlight PAMs and mismatches, and offer downloadable predictions. Its genome discovery and energy-based scores are separate scientific capabilities. OfftargetPred should borrow the workflow, with its own model-specific interpretation and supported inputs.

## Product boundary

**Primary job:** score supplied, aligned guide/off-target sequence pairs with the three sequence-only CRISPert checkpoints. A researcher arrives with candidate sites obtained elsewhere and wants consistent scores, model comparison, and an auditable downloadable result.

The bundle does not supply a genome search engine, genome reference/index, guide-design implementation, guide-level specificity formula, or validated risk bands. Do not expose a genome assembly dropdown, promise genome-wide off-target discovery, label predictions as low/medium/high risk, or copy CRISPRoff/CRISPRspec scores. A separate future discovery pipeline can be added only when genuinely implemented and tested. This distinction needs to appear in the initial form, not only buried in help.

Naming: **OfftargetPred** is the product; **CRISPert** names the scoring models. Explain `k` as the number of aligned base-pair positions per token. CasKAS/epigenetic feature controls are outside scope; no uploads or inputs for them.

## Recommended first release workflow

### Submit

Opening content: `Score candidate CRISPR off-target sites` with a short instruction: `Provide aligned guide and candidate sequences, including their PAMs. Compare sequence-only CRISPert models.`

Use a two-column scientific workbench on desktop: broad working form, narrower format/model explanation. On mobile stack the explanation below inputs. Navigation: `Predict`, `Help`, `About`; a repository link is useful after publication. Avoid unrelated dashboard panels, marketing sections, and hero statistics.

1. **Input method:** `One guide` and `Pair table` as accessible tabs.
   - One guide: a guide DNA sequence field (23 bases, 20-base protospacer + 3-base PAM), and multiline candidate sequences (one 23-base site per line). Optional guide label.
   - Pair table: paste CSV/TSV or upload `.csv`/`.tsv`. Clear accepted canonical fields `target,off_target`, optional `ID`, and documented aliases. Preserve additional user columns as metadata if backend supports it. Do not require measured labels to predict.
   - Both methods have `Load example`, `Clear`, and a downloadable example. Loading an example clearly populates the form; example results must never masquerade as live inference.
2. **Models:** k=1 selected initially, with k=2 and k=3 selectable or `Compare all three` shortcut. Describe k=1 as recommended default based on bundle documentation; no model is best on all external sets. Enforce at least one selected model.
3. Optional job name, only if the backend actually retains jobs. No email field unless notification infrastructure exists.
4. Input preview: valid row count, guide count, selected models. Use a 23-position guide/site alignment as the characteristic visual element, showing a break before the PAM.
5. Primary action `Score candidates`. Report upload/row limits and actual retention directly nearby. Do not invent retention, capacity, or runtime promises; source them from API capabilities/configuration.

### Validation

Validate on both client and server; client feedback helps users and the API remains authoritative.

- Both sequences exactly 23 nt, aligned, PAM last; no gaps/bulges.
- Normalize case and strip surrounding whitespace. Do not silently convert RNA U to DNA T unless this normalization is explicitly documented and agreed by science council; otherwise show a correction hint.
- Only A/C/G/T/N if matching the supplied tokenizer. Explain that N creates unknown model tokens; warn clearly and retain those rows, or reject N if the science/API decision chooses the stricter contract.
- Report invalid row numbers with exact actionable causes. Never silently discard rows or truncate sequences.
- Parse CSV quoting correctly; aliases and ambiguous duplicate columns need explicit handling. Filename extension alone should not decide delimiter if pasted input is supported.
- Preserve input order and row identity; sortable results must not corrupt mapping.
- A guide/site exact match is a sequence match, not proof of a unique genomic on-target. Mismatch counts should state whether they exclude the 3-base PAM. Recommended display: `Protospacer mismatches` plus separately styled PAM difference, with unknown positions excluded or explicitly reported.

Important finding: README claims malformed rows are dropped, but `data.py` currently filters only unequal sequence lengths; equal malformed lengths reach a tokenizer which can truncate. The web API must enforce the intended contract rather than delegate validation to this loader.

### Submission and progress

For jobs, show server-provided states (`Queued`, `Running`, `Complete`, `Failed`) and processed rows only when genuinely reported. Do not fake progress percentages. Keep the submission and result identifier so refreshing can recover a job, with privacy-safe access tokens if results are remotely stored. If the API is synchronous for bounded input, show a truthful indeterminate scoring state and preserve inputs after errors.

A backend unavailable state should explain that scoring could not start and preserve the form. Include a retry control; do not fall back to synthetic scores. HTTP/validation failures must include a usable message without exposing internal tracebacks. Disable duplicate submissions while a request is in flight.

### Results

Lead with the job/model provenance and number of scored pairs. Never describe a score as an experimentally calibrated cleavage probability. Prefer `Model score (0–1)` and explain that larger values indicate stronger predicted off-target signal within this model; independent experiments and context remain necessary.

- Search/filter by guide ID/sequence; sortable model-score columns and protospacer mismatch count.
- Table columns: original row/ID, guide, candidate, mismatches, k=1/k=2/k=3 scores as selected. For sequence alignment, distinguish mismatches with text/underline/background plus color; mark the last three positions as PAM.
- Default results sorted by k=1 if selected, otherwise the first selected model. Label the active sort; provide original-order option.
- Prefer all selected model scores visible together, without invented averaging or ensemble probabilities. Sorting by another model is explicit.
- Coordinates remain user-supplied metadata; do not imply server mapping. Browser links require verified assembly and coordinate convention.
- Download full CSV/TSV and run metadata JSON if supported. Include original row identity, inputs, selected checkpoint/version identifiers, and timestamp. Download all rows, regardless of current pagination/filter, unless the button says `Download filtered rows`.
- Avoid a single guide-level safety number: the input list may omit off-targets and all supplied candidates must be interpreted within that limitation.

### Help and About

Help: a concrete 23-base example showing PAM position, one-guide and CSV examples, recognized aliases, sequence orientation/alignment requirements, N handling, no bulges, score interpretation, comparison of k models, input limits, retention, exports, and resolving errors.

About: architecture summary, three checkpoint configurations, sequence-only scope, source/publication links as available and authorized, model limitations, training/evaluation distinction. The T-cell set is training data, so never promote its metrics as external validation. The iPSC result has only two guides and one with no positives; do not build model selection claims around it. No copy asserting superior accuracy without matching evidence.

## Visual plan and review

### Compact tokens

- Paper: `#F7FAFC` background, reflecting a clean laboratory worksheet.
- White: `#FFFFFF` input/results surfaces.
- Deep blue: `#16334A` primary text and headings.
- Instrument blue: `#1266A8` actions and focused controls.
- Nucleotide teal: `#087F79` matches/PAM accents, used sparingly with text cues.
- Mismatch ochre: `#985000` mismatch emphasis with adequate white contrast.
- Muted text and borders may derive accessible tones from deep blue; failure uses a distinct readable error treatment.

Typography: `IBM Plex Sans` for research interface and `IBM Plex Mono` for sequences, with local or system fallbacks. If fonts are not bundled, use system sans/monospace without an external tracking dependency. Headings 32/24/19 px, body 16 px, dense table 14 px. Sequence letters at least 14 px, tabular numeric scores. Left-align content and keep explanatory line lengths below 80 characters.

Layout A (preferred):

```text
OfftargetPred                         Predict   Help   About
Score candidate CRISPR off-target sites
Short scope sentence

[ One guide | Pair table ]           Input requirements
Guide [.......................]      23 nt, aligned, PAM included
Candidates [                 ]       Sequence alignment preview
           [                 ]       G A T ... | C G G
Load example     Upload table        G T T ... | A G G

Models [x k=1] [ k=2] [ k=3]         How the models differ
Validated rows and errors
[ Score candidates ]                 Data handling summary

Results after submission
Guide filter   Sort by model        Download results
ID | Guide / candidate alignment | Mismatches | k1 | k2 | k3
```

Layout B considered: a centered narrow form with results on a separate route. It simplifies the first screen but hides format guidance and disrupts comparison with submitted sequences. Use A for desktop with stacked responsive content, and keep the scientific form visible during result interpretation.

The distinctive element is the functional 23-position alignment ruler: sequence letters, mismatch marks, and a three-position PAM bracket. Avoid decorative DNA helices, arbitrary gradients, oversized accuracy numbers, marketing card grids, or generated scientific images. Controls have modest 6 px corners; the table uses rows and separators because the content is tabular, not as newspaper decoration.

Plan review against brief: the original reference prioritizes submission, examples, tables, and documentation. This plan preserves those priorities. A potential generic-dashboard direction was rejected because it would prioritize decorative metrics over sequence input. Avoid a genome dropdown solely for visual resemblance: it would promise a missing capability.

## Accessibility and implementation checks

- Native labels, fieldsets/legends for models, semantic table/caption, real buttons, keyboard-operable tabs.
- Visible focus, adequate color contrast, text alternatives for mismatch coloring, no essential hover-only information.
- Screen-reader live status/error summaries; move focus to validation summary or completed results appropriately.
- Responsive at 360 px. Long sequences/table can scroll inside a labeled region; entire page must not overflow.
- Error text associated with fields; drag/drop always has a standard file input alternative.
- Respect reduced motion; no nonessential animation.
- Test real success, malformed pair, ambiguous bases, empty/no-model input, unavailable API, duplicate submit prevention, CSV download, long file, keyboard flow, and mobile.

## Decisions for lead council

1. Ship candidate-pair scoring honestly; add genome discovery only as a separately implemented capability.
2. Confirm default model k=1 and exact ambiguous-base policy with science council.
3. Agree backend job/size/retention capabilities before final UI contract; frontend displays actual configuration.
4. Establish endpoint and checkpoint metadata; no credentials/secrets in static GitHub Pages assets.

## Council reconciliation updates

Science council confirmed: require prealigned 5′→3′ sequences with the PAM in the final three positions; do not silently reverse-complement. Accept ACGTN with a visible warning for unknown-base tokens; reject gaps/bulges. Do not rigidly reject non-NGG PAMs without training-data justification. Use the label **CRISPert score**, a positive-class softmax output in [0,1] that has not been established as calibrated cleavage probability. The embedded 2024 manuscript describes a different, larger architecture with CasKAS benchmarks; the About page must describe these shipped four-layer, sequence-only checkpoints and distinguish their provenance from that manuscript.

Deployment council proposes authenticated job creation/polling/deletion/download, 10,000-pair and 5 MiB request limits, one active GPU worker, 10 queued jobs, and 24-hour retention. These are proposed implementation settings, not claims to display until implemented. Prefer an API capabilities response that publishes limits/model IDs/default/retention/supported modes; the frontend consumes it. Use a per-job bearer capability in session storage, never query strings or analytics. CSV downloads use authenticated fetch to a browser blob. Restore recent jobs within the same browser session; include explicit Delete job when supported.

### Conditional genome discovery workflow

The lead asked the user whether to implement both pair scoring and genuine genome search (human GRCh38 first), or scoring alone. If discovery is selected and a real, validated search engine/index is supplied, use three input choices: `Search a genome`, `One guide`, and `Pair table`.

Genome search fields: installed assembly with unambiguous version/provenance; guide sequence(s) with clear input format; supported PAM choices and maximum mismatches that exactly match the search tool; optional job name. Explain search covers the installed reference, not personal variants. A 20-base guide convenience input is allowed only if the scientific construction of the guide-side PAM is settled and documented; 23-base guide/on-target input avoids inventing bases. Never repurpose free-form genomic regions as if guide design were already implemented.

Discovery job stages should reflect the implementation: candidate search, candidate scoring, complete. Results add chromosome, start/end, strand, reference assembly, total candidates considered, and any search truncation. Explicitly state coordinate indexing convention in exports. Avoid guide-level specificity/safety aggregation; showing ranked candidates remains appropriate. If limits truncate the candidate list, it must be prominently disclosed and a truncated result cannot be presented as a complete genome search. Repeat hits at separate loci must retain their coordinates even when their sequence duplicates.

The mode can be present but unavailable only when the API explicitly reports search unconfigured, with a plain message and link to working pair input. A menu of unavailable genomes adds no value. Candidate search adds different resource/queue/runtime requirements, so limits must be mode-specific rather than assuming the same 10,000 pair cap silently applies to all genomic hits.
