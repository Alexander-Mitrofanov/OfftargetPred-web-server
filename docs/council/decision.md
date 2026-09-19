# Council decision

Date: 19 September 2026.

The initial council reviewed model correctness, user experience and deployment
before implementation. Individual evidence and recommendations are in
[science](science.md), [UX](ux.md) and [deployment](deployment.md).

## Agreed scope

1. Score supplied aligned 23-base guide/site pairs, including their PAMs, with
   the three supplied sequence-only CRISPert-small checkpoints. k=1 is default;
   comparison displays separate scores, never an invented ensemble.
2. Add candidate discovery on human GRCh38 primary assembly, using a pinned
   Cas-OFFinder 2.4.1 build: NGG PAM, zero to four protospacer mismatches, both
   strands, no bulges. Require the actual 23-base guide+PAM for scoring. Genome
   search is enabled only when its reference and executable are installed.
3. Keep perfect protospacer matches visible. Do not infer a unique on-target
   locus, aggregate guide specificity, calibrated cleavage probability or risk
   classes from model softmax scores.
4. Reject malformed data rather than silently dropping or truncating rows. N
   bases in supplied pairs need an explicit uncertainty note. Genome queries
   require unambiguous DNA and an NGG PAM.
5. Implement private asynchronous jobs, bounded requests/queue/candidate counts,
   cancellation, 24-hour retention, authenticated results and downloads, and
   explicit provenance. A truncated search must never be reported as complete.
6. Build an original scientific interface around CRISPRoff's form, examples,
   job progress and results workflow. Use exact model-specific terminology and
   accessible sequence alignments.
7. Follow CasAndra infrastructure: de.NBI GPU worker and API, loopback Nginx,
   Tailscale Funnel HTTPS, and static GitHub Pages frontend. Put mutable data on
   the attached data volume. Preserve existing CasAndra services.

The supplied paper describes an older 12-layer model and experiments involving
CasKAS. These checkpoints are four-layer small models; its headline performance
numbers must not be used as measured performance of this deployment. CasKAS,
epigenetic tracks and model retraining are excluded from this service.

The user was offered a choice of pair-only versus pair-and-genome workflows.
While awaiting a response, the implementation proceeds with both workflows,
human GRCh38 first, matching the stated CRISPRoff-inspired goal. This is a
documented scope assumption rather than a claim that genome search existed in
the supplied model bundle.

## Acceptance evidence

- All three checkpoint identities and configurations, reference-pipeline parity,
  tokenizer behavior, strict inputs and score semantics.
- Search on synthetic forward/reverse-strand fixtures, coordinates and PAM
  boundaries, zero hits, candidate limit and real GRCh38 smoke.
- API authorization, cancellation, retention, limits, CORS and restart behavior.
- Browser desktop/mobile form, real asynchronous result flow and downloads.
- GPU inference, storage, SSH, public TLS/API and deployed Pages connectivity.
