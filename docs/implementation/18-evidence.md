# Improvement 18 — browser-local experimental observations

## Delivered

- `frontend/src/features/assayEvidence.ts`: bounded strict generic CSV/TSV parser,
  explicit paired/candidate/coordinate matching, ambiguity-preserving indexes,
  duplicate preservation, provenance and browser SHA256 helpers.
- `frontend/src/components/AssayEvidence.tsx` and `.css`: labelled input controls,
  clear preview/apply lifecycle, paginated error/observation/match lists, applied
  import clearing, explicit zero/unmatched interpretation and synthetic examples.
- `tests/frontend/assayEvidence.test.ts`: 20 focused tests.
- `docs/experimental-evidence.md`: exact schemas, coordinate interpretation,
  matching rules, privacy, limits, provenance and synthetic fixtures.

This improves comparison of user experiments with an existing published predictor.
It makes no new method, calibration or performance claim. Native GUIDE-seq or
CIRCLE-seq format variants are not silently accepted.

## Integration contract

```tsx
import { AssayEvidence } from "./AssayEvidence";
import type { EvidenceState } from "../features/assayEvidence";

const [evidence, setEvidence] = useState<EvidenceState | null>(null);
<AssayEvidence rows={completeDocument.rows} onEvidenceChange={setEvidence} />;
```

Mount the component under the result-document/job key; an import belongs to exactly
one complete result. Parent owns the analysis workspace and export integration.
Use `evidence.per_row` by `result_index`, with `candidate_key` as an identity check.
Do not index only by the key: duplicate result rows remain separate by document
position. Export the **complete** state, including unmatched and duplicate
observations, for example under `experimental_evidence` in browser JSON/bundles.
Server-downloaded original results do not contain browser-local evidence.

No shared API type or ResultRow mutation is required. Optional row badges should
say “possible imported observation” when any match is ambiguous, and “reported zero”
when only zero observations match. An unmatched prediction is never “negative”.
Raw counts are preserved; they are not multiplied, summed or interpreted as
independent replicates. Any eventual CSV export must apply existing spreadsheet
formula protection to user-provided identifiers and metadata. This component uses
React text nodes and never inserts HTML from an import.

## Verification

Focused command:

```bash
node --experimental-strip-types tests/frontend/assayEvidence.test.ts
```

All 20 tests pass. Cases cover full pair identity, candidate-only ambiguity,
multiple loci, duplicate observations and result identities, zero/unmatched
semantics, both coordinate conventions and strands, assembly/convention/strand
requirements, chromosome aliases, optional guide restriction, rejected gaps and
PAM placeholders, malformed CSV, duplicate/unknown headers, unsafe numeric values,
quoted HTML/formula-like identifiers as data, size/match-link bounds, unchanged
predictions, synthetic examples and hashes of pasted text/original file bytes.
Frontend `tsc --noEmit` passes. Full browser integration is owned by the coordinator;
no live deployment, remote assay requests or private data publication was performed.

## Remaining dependencies

The parent must mount the component, retain its callback state and include that
state in the browser analysis export. This feature cannot verify whether a supplied
assay was conducted, whether its coordinate conversion was correct or whether
unobserved candidates were experimentally tested. Such limitations are explicit
in the interface and exported metadata.
