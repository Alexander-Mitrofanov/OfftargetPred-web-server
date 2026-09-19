# 30 — Other nucleases and editing modalities

Delivered 19 September 2026 by dedicated worker `improvement_30_nucleases`.

**Status: scope audit complete; new nuclease/editor modes deferred.** This
decision preserves the user's priority: a usable web interface to the published
CRISPert method. New biological tasks are optional extensions, not scientific
novelty requirements imposed on this release.

## Deliverables

- [Extension assessment](../extensions/nucleases.md): exact current contract,
  modality-specific representation and outcome differences, distinction from
  wider SpCas9 PAM/search scope, concrete dependencies and UI wording audit.
- This delivery note: bounded decision, inspected evidence and integration handoff.

## Evidence reviewed

The review read the model card, model manifest, checkpoint and dataset provenance,
current pair validator, inference adapter, genome-search implementation, settings,
API capability fields, README, Help/About, input helper and original council
items 22/30. It also checked primary publications for Cas12a/Cpf1, SpCas9-HF1,
base editing and prime editing; citations accompany the relevant assessment.

The code receives two aligned 23-base strings and the chosen k model; it has no
nuclease/editor input. Shape-compatible strings alone therefore cannot establish
variant- or modality-specific predictions. Experimental reagent identity in the
supplied datasets remains unresolved, so the assessment retains the precise
“SpCas9-style” wording used by the provenance records.

The current genome workflow searches GRCh38 primary assembly, NGG, both strands
and 0–4 substitutions without bulges. Broader compatible SpCas9 candidate PAM or
mismatch enumeration is the separate [item 22](22-scope.md) decision. It does not
automatically establish a new protein variant or editing modality.

## Shared UI handoff

No explicit unsupported-nuclease claim was found. The model card's nuclease
boundary is missing beside the Help input instruction, so two concise Help/About
sentences were sent to the coordinator and preserved verbatim in the assessment.
The coordinator owns `frontend/src/App.tsx`; this worker changed no shared UI,
API, inference, model, reference or runtime file. Suggested copy must not be
reported as already integrated until the coordinator makes that change.

## Verification and limits

This is a documentation-only scope assessment. The relevant control flow and
provenance were inspected directly; no uncertain numerical behavior required a
new test, model inference, VM workload or download. Markdown whitespace and
relative-link targets were checked. Existing test results are not presented as
new validation of other nucleases or editors.

No new model is trained or installed, no genome is downloaded, no live service is
changed and no private artifact is redistributed. Further support requires a
named use case, compatible model/input and task-specific evidence, permissions,
resource measurements and a tested user workflow as detailed in the assessment.
