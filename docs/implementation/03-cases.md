# 03 — Public-reference case studies

Implemented 19 September 2026 as a separate, bounded worker assignment. The
coordinator reused the completed improvement-02 worker because new-agent creation
was rejected by the tool's thread limit. Its earlier benchmark assignment and
files were preserved; this delivery covers improvement 03 only.

## Delivered

- `scripts/generate_demonstrations.py`
- `frontend/public/demonstrations/manifest.json`
- `frontend/public/demonstrations/reference-walkthrough.json`
- `frontend/public/demonstrations/multiple-exact-matches.json`
- `frontend/public/demonstrations/no-hits.json`
- `docs/case-studies.md`
- `tests/test_demonstrations.py`

The four scenarios are a selected public locus with a complete 15-candidate
one-mismatch search, a complete 13-candidate zero-mismatch search showing five
identical 23 nt matches, an actually completed synthetic zero-hit search, and an
observed HTTP-422 missing-PAM error. No successful result contains more than
100 rows. No result was downsampled, fabricated or labelled complete after
truncation. The normal result is reused from the coordinator's verified staging
acceptance run. The other two searches ran on staging API port 8020 and their
temporary jobs were deleted. Live services were not changed.

All successful documents preserve actual reference/search settings, all three
unchanged CRISPert model hashes and scores, CFD identity and available Ensembl115
annotations. The zero-hit document retains its submitted guide and complete
metadata but has no scored candidate rows. All sequences derive from public
Ensembl GRCh38 reference DNA or are explicitly marked synthetic. These are
software workflow examples, with no wet-lab validation or guide-safety claim.

## Integration contract for examples UI (12)

Fetch `demonstrations/manifest.json` relative to `import.meta.env.BASE_URL` so
GitHub Pages' repository prefix works. `schema_version` is 1:

```text
{
  schema_version, generated_at, note, generator_sha256,
  normal_source_document_sha256, staging_jobs_created_and_deleted,
  scenarios: [{
    id, kind: "result" | "validation", title, summary,
    tasks: string[], input: Submission, settings,
    expected_observations: string[], provenance,
    document_filename: string | null,
    document_sha256: string | null,
    completed_job: Job | null,
    expected_error?: { http_status, detail }
  }]
}
```

For a result scenario, fetch its `document_filename` from the same directory.
Pass the document and `completed_job` to `AnalysisWorkspace` with
`demonstration={true}`, no credentials and a component key of `scenario.id`.
The document is an ordinary complete `{rows, metadata}` analysis. Its metadata
contains a `demonstration` note, actual original run timestamps when available,
and a freezing timestamp. Presentation job IDs begin with `demonstration-` and
are deliberately disconnected from real jobs. Presentation `created_at` and
`finished_at` are freeze timestamps, not invented dates of the reused original
run. Examples have no expiring links, access tokens or delete operation.

For the validation scenario, show its observed error and correction task.
It has no document and no completed job. Never create a fake result for it.
The input can populate the form after an explicit user action. Running any
example as a new server job must likewise be an explicit action; viewing the
frozen examples requires no backend or queue submission.

Use exact-match terminology carefully: the 13 zero-mismatch sites match the
20 nt spacer, while only five match the entire 23 nt sequence. Only the first
walkthrough includes an explicitly selected intended locus. Raw coordinates
are 0-based half-open; the explanatory text uses 1-based inclusive display.

## Reproduce and verify on the VM

From `/srv/crispert/staging/nar-v2`, with the isolated API/worker running:

```bash
/srv/crispert/staging/test-venv/bin/python scripts/generate_demonstrations.py

sudo -n env \
  PYTHONPATH=/srv/crispert/staging/nar-v2/backend:/srv/crispert/venv/lib/python3.12/site-packages \
  OFFTARGET_DEMO_REFERENCE=/srv/crispert/staging/reference/Homo_sapiens.GRCh38.dna.primary_assembly.fa \
  /srv/crispert/staging/test-venv/bin/python -m pytest tests/test_demonstrations.py -q
```

The generator is restricted to localhost HTTP port 8020 and rejects live/remote
API destinations. It never opens a private assay data file. Each created job
uses its returned capability token only in process memory and is deleted in a
`finally` block. The normal source document defaults to
`output/staging-genome.json`; overriding it is supported, but its input,
complete-result count and explicitly selected locus are verified.

**Verification: 12 tests passed in 7.07 seconds on the VM.** Checks include actual
CFD recomputation, manifest/document hashes, known exact-match distinctions,
zero-hit guide preservation, real HTTP-422 evidence, credential absence,
truncation rejection and direct reference verification of all 15 distinct loci.
No local model or genome inference was run. Public-checkout CI skips only the
optional direct-FASTA test when the reference environment variable is absent.
