# Other nucleases and editing modalities

**Decision, 19 September 2026: defer additional nuclease/editor modes.** This
release makes the published CRISPert method easier to use through the supplied,
unchanged sequence-only CRISPert-small checkpoints. Supporting Cas12, engineered
Cas9 variants, base editors or prime editors is an optional future project. It
is not a scientific-novelty requirement for the present web-interface release.

## Exact current task

The service assigns a separate, uncalibrated positive-class score from k1, k2
and/or k3 to an aligned **SpCas9-style guide/candidate sequence pair**. Each
sequence has 20 protospacer bases followed by its actual three-base PAM, written
in the same 5′→3′ orientation. Scores rank candidate sites within the stated
model domain; they do not estimate editing frequency, on-target efficiency,
therapeutic safety or a particular editor's product distribution.

The [model card](../model-card.md), [artifact manifest](../../models.manifest.json)
and [dataset-role records](../science/dataset-roles.json) define the evidence.
The original experimental reagent and precise nuclease variant are unresolved
in those provenance records. “SpCas9-style” describes the supported sequence
contract; it must not be expanded into a claim that every supplied observation
has independently verified wild-type SpCas9 provenance.

| Operation | Implemented scope |
| --- | --- |
| Candidate-pair scoring | Two ungapped 23-base DNA strings; A/C/G/T/N, with an ambiguity warning for N. The service neither realigns inputs nor adds or moves a PAM. Non-NGG candidate PAMs can be scored; that acceptance supplies no new biological validation. |
| Genome discovery followed by scoring | Human GRCh38 primary assembly, Ensembl 115, NGG candidates, both strands, 0–4 protospacer substitutions, no bulges. Cas-OFFinder 2.4.1 uses the pinned reference. |
| Model selection | The three pinned CRISPert-small checkpoints, with different k-mer settings and reported pretraining histories; no nuclease or editor selector. CasKAS and other epigenetic features are excluded. |
| Separate CFD baseline | The documented SpCas9 CFD implementation. Its presence does not extend CRISPert or establish editor-specific validity. |

Pair validation in [sequence.py](../../backend/offtargetpred/sequence.py)
checks string shape, not the identity of the biological reagent. The
[inference adapter](../../backend/offtargetpred/inference.py) receives sequence
pairs and model names; it has no nuclease identity, editing window, desired edit
or editor-specific context. Identical pairs therefore have identical model
inputs regardless of the experiment a user has in mind. This is a code-based
reason why a successful submission cannot establish support for a new task.

## Why compatible strings are insufficient

The following are scientific distinctions relevant to future scope decisions,
not claims that these extensions have been evaluated by this service.

| Proposed extension | Missing representation or task evidence | Necessary user input and outcome definition |
| --- | --- | --- |
| Cas12-family nuclease, such as Cas12a | The family cannot be represented by simply treating a different sequence as the present 20+3 PAM-last contract. Cas12a/Cpf1 has distinct target-recognition geometry, including a 5′ PAM, and cleavage behavior. | Name the ortholog/variant, guide length, PAM sequence and position, alignment convention and measured cleavage/off-target endpoint. Supply a compatible model and independently verified input adapter. |
| High-fidelity or other engineered Cas9 variants | Some use the same 20+3 sequence geometry, but changed protein recognition can alter off-target behavior. Current models have no variant input and no demonstrated variant-specific evaluation. | Name the exact protein variant, guide design and experimental context; distinguish variant-specific off-target ranking from generic sequence similarity. Establish transfer validity or use a separately validated compatible model. |
| Base editor | A sequence-pair classifier does not represent the requested conversion, editor/deaminase, editing window, bystander edits or product distribution. A cleavage label is not interchangeable with a base-conversion label. | Name the editor construct, target base/desired conversion, relevant sequence context and endpoint: intended conversion, bystander conversion, indels or a clearly specified off-target class. Keep these outcomes distinct. |
| Prime editor | The current pair omits the pegRNA primer-binding and reverse-transcription-template information, desired edit and any additional nicking guide. | Record editor version, full pegRNA design, desired edit/reference context and protocol-specific extra guides. Define precise-edit yield, unintended products or a particular off-target endpoint before selecting a predictor. |

The Cas12a distinction follows the original
[Cpf1 characterization](https://pmc.ncbi.nlm.nih.gov/articles/PMC4638220/).
Engineered SpCas9-HF1 showed altered specificity compared with wild-type SpCas9
in the [original high-fidelity Cas9 study](https://www.nature.com/articles/nature16526).
The original [base-editing study](https://www.nature.com/articles/nature17946)
describes programmable base conversion and an editing window, while the original
[prime-editing study](https://www.nature.com/articles/s41586-019-1711-4) describes
an edit-encoding pegRNA and reverse transcription. Our conclusion from these
distinct inputs and outcomes is that a common DNA-string length is insufficient
to transfer the current checkpoints to those tasks.

## Difference from wider SpCas9 search

[Improvement 22](../search-scope.md) considers additional compatible three-base
SpCas9 candidate PAMs and larger substitution limits. Those changes can preserve
the ungapped 20+3 input representation and need not require a new architecture.
They still need explicit enumeration rules, reference checks, model-stratum
evidence and measured resource limits. They are currently deferred.

Changing a search PAM pattern does not select a new nuclease model. In
particular, an engineered PAM-recognition variant remains a variant-specific
question even if its candidate sequences fit 23 characters. Search support,
sequence-format compatibility and biological predictive validity are separate
properties and should appear separately in any future support matrix.

## Concrete dependencies for an optional extension

1. **A requested workflow and narrow endpoint.** Choose one named nuclease or
   editor and the research question it will answer. Reusing an established
   predictor with suitable permissions is possible; developing a novel method
   is not inherently required. Do not combine all “off-target effects” into one
   unsupported probability or safety category.
2. **An explicit, versioned input contract.** Preserve nuclease/editor identity,
   raw guide and candidate, actual PAM position, strand, assembly, coordinates
   and task-specific context. Do not trim, pad, move a PAM or discard pegRNA
   extensions just to fit the present model. A new representation may require
   a separate adapter or architecture.
3. **Traceable compatible evidence.** Obtain the predictor's training-domain
   record and relevant evaluation observations with reagent, assay, candidate
   universe, detection limits and label definitions. Use appropriate held-out
   guides and distinguish known corpus overlap from unknown training membership.
   Evaluate the named endpoint on the actual artifacts to be served. Missing
   observations and assay zeros must not become assumed biological negatives.
4. **Artifact and software permissions.** Resolve rights for model weights,
   upstream code and evaluation data, pin versions and hashes, and document
   attribution. The MIT licence on project-owned code does not grant those
   separate rights. New training is needed only if no suitable validated model
   exists or transfer is inadequate; no new training is planned for this release.
5. **Measured operation on de.NBI.** Measure per-request runtime, GPU/CPU RAM,
   model/index/reference disk use and candidate expansion for the actual mode.
   Define quotas, timeouts, cancellation, admission and reproducible deployment
   before advertising availability. Existing V100 measurements cannot predict
   the needs of a different predictor; no capacity estimates are invented here.
6. **An understandable interface and outputs.** Offer only enabled, validated
   workflows. Explain required task-specific fields with a runnable example,
   keep model/endpoint names beside each score, export that provenance, and
   prevent comparisons of incomparable score scales. A discovery-only candidate
   must have an explicit unavailable-score reason and remain outside scored-rank
   summaries. Test the new workflow with representative users.

No compatible additional checkpoints or modality-specific evaluation package
has been supplied. This assessment installs nothing, trains nothing, changes no
runtime setting and publishes none of the private bundle. The present interface
can be reviewed for usefulness and usability within its existing scope.

## User-facing wording audit

The model card explicitly excludes other nucleases. The inspected Help/About,
README, input helper and inference/search metadata contain no explicit claim of
Cas12, variant-specific Cas9, base-editor or prime-editor support. Help currently
explains the input length and PAM but does not name SpCas9 beside that instruction.
To make the boundary easier to find, the coordinator can add:

- Under Help → “Two aligned sequences, 23 bases each”: “This service uses the
  supplied CRISPert-small checkpoints for aligned SpCas9-style sequence pairs.”
- Under About → “Scope and interpretation”: “Cas12, high-fidelity Cas9 variants,
  base editors and prime editors are outside the validated scope of these
  checkpoints. A 23-base input alone does not establish support.”

These are targeted clarity changes, not a request for additional modes or a
new scientific-novelty gate. The implementation note records the review and the
coordinator's separate responsibility for integrating shared interface copy.
