# OfftargetPred usability study protocol

**Status: prepared; no human participant study has been conducted or results claimed.**
This is a study plan for an easy-to-use web interface to the published CRISPert
method. It does not test a new scientific method or establish clinical utility.
Automated tests and developer reviews cannot substitute for participant observations.

## Participants and setting

Recruit 5–8 biologists who handle CRISPR guide selection or off-target experiments.
Include a mix of researchers who know CRISPert and those who have never used it;
seek at least two who do not routinely write analysis code. Include an accessibility
user where recruitment permits, and record the assistive technology used with their
agreement. Record experience bands rather than names in the analysis sheet.

Use a 30–45 minute session on the participant's usual computer and browser. Offer
keyboard-only use. Use the released/staged version under assessment and record its
commit, URL, browser, viewport and date. Do not run the study against an unspecified
moving branch. Use public example inputs or artificial input-format exercises.
Do not ask for unpublished sequences, patient data or lab credentials.

Before starting, explain that the interface is being evaluated, participation is
voluntary, stopping is allowed, and the facilitator is not evaluating their biology
skills. Follow the institution's applicable ethics and consent process. Obtain
separate consent before recording screens/audio; recording is optional. Never
record a live private-job capability URL or token. Store notes without participant
names, following the institution's retention policy. Researchers can also run an
unrecorded observation session with consent.

## Facilitation

Read each task verbatim. Let participants think aloud, but do not teach the
interface first. Start a timer when the task is read. If they ask for help, first
ask what they expect to happen; provide help after they request it or after two
minutes without progress. Record the help and where it occurred. Stop a task at
five minutes and mark it incomplete rather than recording a fabricated success.

Task order: 1, 2, 3, then counterbalance 4–6 between participants. Treat download
and deletion tasks independently to avoid deleting results before they are used.
Use the built-in frozen result example when the real queue is unavailable; record
that substitution and do not count it as evidence of successful live submission.

## Tasks and success criteria

| Task to read | Observable completion criterion | Main failure to watch for |
| --- | --- | --- |
| 1. “Try the example and tell me which sequences are compared and what the output means.” | Opens an example, finds candidate-specific scores, describes them as relative uncalibrated predictions. | Treats a score as a cleavage probability or complete guide-safety estimate. |
| 2. “Score this small table from a collaborator. Its headers are `sample_name`, `guide_with_PAM`, and `candidate_with_PAM`.” | Chooses the intended columns, checks the preview, applies mapping and reaches a successful submission or the clearly identified frozen-example substitute. | Swaps guide/candidate, silently loses required metadata, cannot find mapping or submit. |
| 3. “This input is only a 20-base spacer. Find out what the service needs before you proceed.” | Identifies the missing actual PAM and uses the reference resolver with a supplied verified GRCh38 interval, or correctly explains that the observed PAM is required. | Appends a guessed PAM, confuses genomic strand/orientation, assumes a spacer alone can be scored. |
| 4. “In this completed result, find candidates for this guide with two or fewer mismatches. Select two and save a shortlist.” | Applies the correct guide and mismatch filters, selects intended rows and exports the selection. | Confuses the displayed page with the full candidate set or thinks filtering reruns a genome search. |
| 5. “Check one candidate's genome context and explain the coordinates and annotation.” | Identifies assembly, locus/strand, and available annotation; understands missing annotation is not intergenic evidence. | Interprets displayed 1-based coordinates as raw BED coordinates, or assumes annotation proves biological harm. |
| 6. “Save enough information to revisit this analysis, and then remove the private job.” | Finds provenance/downloads and the privacy/deletion controls; understands possession of a private link permits access and that jobs expire. | Publishes a token, expects indefinite retention, assumes downloading deletes the server job. |

Prepare the collaborator table with 12 valid sequence pairs copied from the
explicitly redistributable built-in example fixture. Create a second copy with a
20-nt candidate on data row 12 to check whether errors beyond the preview are
understood. Record the fixture file and hash in the study record. Do not use
private training/assay data merely because it exists in the deployment folder.

For the resolver task, prepare one verified reference interval from the same
release/reference used by the server. Check it before the session. If the helper
is unavailable, use the explanation-only task and record the limitation.

## Measures and release review

Record task completion as **unassisted**, **assisted**, **incomplete**, or **not
attempted**. Record time, errors, backtracks, facilitator interventions, and the
participant's own explanation of scores/search scope. After each task ask “How
easy or difficult was that?” on a 1–7 scale (1 very difficult, 7 very easy).
After all tasks ask which step they would change first and what information they
expected but could not find.

Initial product targets, to be assessed after observations rather than presented
as achieved:

- At least 80% of attempted core tasks 1–4 complete unassisted.
- No participant leaves believing a model score is a calibrated probability, that
  supplied pair lists are a complete genome search, or that a guessed PAM is valid.
- Every blocking input failure has a discoverable next step.
- The main input, filtering, export and deletion paths work with the keyboard and
  at a 390-pixel viewport in the separate automated/manual accessibility checks.

With 5–8 participants, report descriptive counts, medians and ranges, plus concrete
issues and changes. Do not infer population-wide success or statistical superiority.
Report task exclusions and assisted completion separately. Fix severe issues,
then retest affected tasks with at least two participants who did not see the
previous interface where feasible. Record unresolved issues explicitly.

## Observation sheet (empty template)

Copy the following for each participant. **All fields are pending.**

- Participant code / experience band:
- Session date / consent recorded / recording consent:
- Release commit / fixture hash / URL:
- Browser / viewport / input method / assistive technology:

| Task | Completion category | Time (s) | Error or misunderstanding | Assistance given | Ease (1–7) | Change suggested |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pending | | | | | |
| 2 | Pending | | | | | |
| 3 | Pending | | | | | |
| 4 | Pending | | | | | |
| 5 | Pending | | | | | |
| 6 | Pending | | | | | |

Issue log:

| Issue | Evidence / participant codes | Severity | Fix / commit | Retest result |
| --- | --- | --- | --- | --- |
| Pending actual observations | | | | |

## Publication wording

Until sessions occur: “The interface includes input validation, guided examples
and provenance exports. A representative-user evaluation is planned using the
published protocol.” After sessions occur, describe the actual participants,
tasks, results, observed problems and revisions. Do not relabel automated browser
checks as a human usability study, and do not imply that the NAR editors have
approved the service.
