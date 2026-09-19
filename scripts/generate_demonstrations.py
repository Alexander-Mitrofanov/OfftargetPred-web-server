"""Freeze complete public-reference examples from an isolated staging API.

The normal case reuses a previously verified complete public-reference result.
Other successful cases run through the staging search/model/annotation worker.
Every created job is deleted. Private supplied assay files are never accessed.
"""

from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_GUIDE = "TGAGACTCTTGCAGTCACACAGG"
SYNTHETIC_GUIDE = "ACGTCAGTACGATCGTACGATGG"
REFERENCE_SHA256 = "1e74081a49ceb9739cc14c812fbb8b3db978eb80ba8e5350beb80d8ad8dfef3b"
REFERENCE_LOCUS = {"target": PUBLIC_GUIDE, "chromosome": "1", "start": 100056,
                   "end": 100079, "strand": "+", "assembly": "GRCh38"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def submission(sequence: str, mismatches: int, name: str, selected: bool = False) -> dict:
    value = {"mode": "genome", "input": sequence, "format": "text", "models": [1, 2, 3],
             "name": name, "assembly": "GRCh38", "max_mismatches": mismatches}
    if selected:
        value["intended_loci"] = [REFERENCE_LOCUS]
    return value


def validate_document(document: dict, guide: str, max_mismatches: int) -> None:
    """Fail closed on truncated, incompatible or incomplete example artifacts."""
    rows, metadata = document["rows"], document["metadata"]
    if len(rows) > 100 or metadata.get("candidate_count") != len(rows):
        raise ValueError("Demonstrations must contain every candidate and at most 100 rows.")
    if metadata.get("reference", {}).get("sha256") != REFERENCE_SHA256:
        raise ValueError("Demonstration reference must be the pinned Ensembl115 GRCh38 primary assembly.")
    if metadata.get("max_mismatches") != max_mismatches:
        raise ValueError("Mismatch setting differs from the frozen input.")
    if metadata.get("candidate_scope") != "Complete within the stated reference, PAM and mismatch limits.":
        raise ValueError("Only completed, untruncated searches may be frozen.")
    if metadata.get("model_keys") != ["k1", "k2", "k3"] or metadata.get("device") != "cuda":
        raise ValueError("All three unchanged models must be selected on the VM.")
    if metadata.get("annotations", {}).get("available") is not True:
        raise ValueError("Compatible Ensembl annotation must be available.")
    submitted = metadata.get("submitted_guides", [])
    if len(submitted) != 1 or submitted[0].get("target") != guide:
        raise ValueError("Submitted guide must be recorded even when no candidates are found.")
    loci = set()
    for row in rows:
        if row["target"] != guide or set(row["scores"]) != {"k1", "k2", "k3"}:
            raise ValueError("Result must preserve its guide and all model scores.")
        if any(not isinstance(score, (int, float)) or not 0 <= score <= 1 for score in row["scores"].values()):
            raise ValueError("Invalid model score.")
        if row.get("baselines", {}).get("cfd", {}).get("score") is None:
            raise ValueError("Every actual candidate must have a CFD score.")
        if row.get("annotations", {}).get("status") != "annotated":
            raise ValueError("Every candidate must have annotation context.")
        if row.get("assembly") != "GRCh38" or row.get("coordinate_system") != "0-based half-open" or row["end"] - row["start"] != 23:
            raise ValueError("Every candidate must retain its forward-reference 23 nt interval.")
        if row["strand"] not in ("+", "-") or row["off_target"][-2:] != "GG" or row["mismatches"] > max_mismatches:
            raise ValueError("Candidate is outside the stated discovery scope.")
        key = (row["chromosome"], row["start"], row["strand"])
        if key in loci:
            raise ValueError("Duplicate locus in the frozen result.")
        loci.add(key)


class StagingClient:
    def __init__(self, origin: str):
        parsed = urlparse(origin)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.port != 8020 or parsed.path not in ("", "/"):
            raise ValueError("This generator is restricted to the isolated localhost staging API on port 8020.")
        self.origin = origin.rstrip("/")
        self.deleted_jobs = 0

    def request(self, path: str, method: str = "GET", value: dict | None = None, token: str | None = None):
        # This is a local operator CLI, not a browser request; CORS origin is
        # intentionally absent, as for other authenticated API clients.
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if value is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.origin + "/api/v1" + path, headers=headers, method=method,
                          data=json.dumps(value).encode() if value is not None else None)
        with urlopen(request, timeout=60) as response:
            return json.load(response)

    def run(self, value: dict) -> tuple[dict, dict]:
        job = self.request("/jobs", "POST", value)
        token, identifier = job["token"], job["id"]
        try:
            started = time.monotonic()
            while time.monotonic() - started < 960:
                status = self.request("/jobs/" + identifier, token=token)
                if status["status"] in ("completed", "failed", "cancelled"):
                    break
                time.sleep(2)
            else:
                raise RuntimeError("Staging demonstration job did not finish within 960 seconds.")
            if status["status"] != "completed":
                raise RuntimeError("Staging demonstration job failed: " + str(status.get("error", status["status"])))
            return self.request("/jobs/" + identifier + "/download?format=json", token=token), status
        finally:
            deletion = self.request("/jobs/" + identifier, "DELETE", token=token)
            if deletion.get("status") not in ("deleted", "deleting"):
                raise RuntimeError("Staging job cleanup was not acknowledged.")
            self.deleted_jobs += 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-origin", default="http://127.0.0.1:8020")
    parser.add_argument("--normal-document", type=Path, default=ROOT / "output/staging-genome.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "frontend/public/demonstrations")
    args = parser.parse_args()
    client = StagingClient(args.api_origin)
    health = client.request("/health")
    if not health.get("worker", {}).get("available"):
        raise RuntimeError("Staging worker is unavailable.")
    generated = datetime.now(timezone.utc).isoformat()
    common_note = "Frozen software demonstration using public reference DNA or an explicitly synthetic query. No experimental cleavage measurement or guide-safety claim."
    cases = []

    def freeze(identifier: str, title: str, summary: str, tasks: list[str], payload: dict,
               document: dict, status: dict | None, observations: list[str], sequence_origin: str):
        validate_document(document, payload["input"], payload["max_mismatches"])
        frozen = copy.deepcopy(document)
        frozen["metadata"]["demonstration"] = {"id": identifier, "frozen_at": generated,
            "sequence_origin": sequence_origin, "note": common_note, "complete_result": True,
            "original_result_created_at": status.get("created_at") if status else None,
            "original_result_finished_at": status.get("finished_at") if status else None}
        filename = identifier + ".json"
        args.output_dir.mkdir(parents=True, exist_ok=True)
        path = args.output_dir / filename
        path.write_text(json.dumps(frozen, indent=2, sort_keys=True, allow_nan=False) + "\n")
        metadata = frozen["metadata"]
        completed_job = {"id": "demonstration-" + identifier, "status": "completed", "mode": "genome",
            "name": title, "models": [1, 2, 3], "created_at": generated,
            "finished_at": generated, "result_count": len(frozen["rows"])}
        cases.append({"id": identifier, "kind": "result", "title": title, "summary": summary,
            "tasks": tasks, "input": payload, "settings": {"assembly": "GRCh38", "pam": "NGG",
                "max_mismatches": payload["max_mismatches"], "models": [1, 2, 3], "cfd": True,
                "annotation_source": "Ensembl", "annotation_release": "115", "bulges": False},
            "expected_observations": observations,
            "provenance": {"sequence_origin": sequence_origin, "reference": metadata["reference"],
                "model_checkpoints": metadata["models"]["models"], "annotation_index_sha256": metadata["annotations"]["index_sha256"],
                "cfd_version": metadata["baselines"]["cfd"]["version"], "backend_release_id": metadata["release_id"],
                "complete_result": True, "candidate_count": len(frozen["rows"]), "note": common_note},
            "document_filename": filename, "document_sha256": sha256(path), "completed_job": completed_job})

    normal = json.loads(args.normal_document.read_text())
    validate_document(normal, PUBLIC_GUIDE, 1)
    if len(normal["rows"]) != 15 or sum(bool(row.get("user_selected_locus")) for row in normal["rows"]) != 1:
        raise ValueError("Normal example must be the verified 15-row, explicitly selected-locus case.")
    freeze("reference-walkthrough", "Explore a public reference guide", "Follow a selected GRCh38 locus through candidate search, score comparison and annotation.",
        ["Find the explicitly selected chromosome 1 locus.", "Inspect the highlighted spacer and PAM differences.", "Compare separate model ranks and inspect genomic context.", "Select candidates and export the displayed analysis."],
        submission(PUBLIC_GUIDE, 1, "Public reference walkthrough", selected=True), normal, None,
        ["15 candidates form the complete NGG search result within one protospacer mismatch.",
         "One locus was explicitly selected: chromosome 1, 100057–100079 on the plus strand (1-based inclusive).",
         "Other exact matches remain visible; sequence identity alone does not identify an intended locus.",
         "All three CRISPert scores and CFD are separate, uncalibrated outputs; annotations describe context."],
        "Ensembl115 GRCh38 primary assembly; plus-strand chromosome 1 interval [100056,100079), read from the pinned public FASTA.")

    duplicate_input = submission(PUBLIC_GUIDE, 0, "Public multi-locus exact-match example")
    duplicated, duplicated_status = client.run(duplicate_input)
    exact = sum(row["off_target"] == row["target"] for row in duplicated["rows"])
    if exact < 2:
        raise ValueError("Duplicate example must contain at least two identical 23 nt matches.")
    if any(row.get("user_selected_locus") for row in duplicated["rows"]):
        raise ValueError("Multi-locus example must not silently select an intended locus.")
    freeze("multiple-exact-matches", "Understand multiple exact matches", "The same guide can match several reference loci, even with no spacer mismatches.",
        ["Count exact protospacer matches and full 23 nt matches separately.", "Inspect matching loci on both reference strands.", "Use exact-match filtering without assuming that every exact match is an intended target."],
        duplicate_input, duplicated, duplicated_status,
        [f"{len(duplicated['rows'])} candidates form the complete zero-protospacer-mismatch NGG result.",
         f"{exact} candidates also match the full 23 nt guide-associated sequence; other sites differ in the first PAM base.",
         "No intended locus is selected in this example, and no candidate is automatically discarded.",
         "Reference duplication is a software interpretation example, not experimental evidence of cleavage."],
        "Same public GRCh38-derived guide as the walkthrough, searched independently at zero protospacer mismatches.")

    empty_input = submission(SYNTHETIC_GUIDE, 1, "Synthetic zero-hit search example")
    empty, empty_status = client.run(empty_input)
    if empty["rows"]:
        raise ValueError("The fixed synthetic query unexpectedly has candidates; do not relabel or truncate it as zero-hit.")
    freeze("no-hits", "Interpret a completed search with no hits", "A deliberately synthetic guide illustrates an empty result from a successful bounded search.",
        ["Check that the submitted guide remains visible with zero candidates.", "Read the reference, PAM and mismatch limits.", "Distinguish a completed empty search from an API failure or a safety conclusion."],
        empty_input, empty, empty_status,
        ["The completed GRCh38 primary-assembly NGG search found zero candidates within one protospacer mismatch.",
         "The query is synthetic and does not represent a verified biological editing target.",
         "No candidate scores exist because no candidates were found.",
         "Zero hits within this scope does not establish genome-wide safety or exclude hits under other settings."],
        "Fixed synthetic 20 nt protospacer with an explicitly specified synthetic TGG PAM; not sampled from a private assay or claimed as a genomic target.")

    invalid_input = submission(PUBLIC_GUIDE[:20], 1, "Missing PAM validation example")
    try:
        unexpected = client.request("/jobs", "POST", invalid_input)
    except HTTPError as error:
        body = json.loads(error.read())
        if error.code != 422:
            raise RuntimeError("Invalid-input demonstration did not return validation HTTP 422.") from error
        expected_error = {"http_status": error.code, "detail": body.get("detail")}
    else:
        if "id" in unexpected and "token" in unexpected:
            client.request("/jobs/" + unexpected["id"], "DELETE", token=unexpected["token"])
        raise RuntimeError("The invalid 20 nt input was unexpectedly accepted.")
    cases.append({"id": "missing-pam", "kind": "validation", "title": "Fix a guide with a missing PAM",
        "summary": "A 20 nt spacer needs a real, guide-associated PAM before the sequence model can score it.",
        "tasks": ["Notice that this input is only 20 nt.", "Use the guide resolver with chromosome 1 interval 100057–100076, then choose the actual public-reference locus.", "Verify the resulting 23 nt sequence instead of inventing or appending a guessed PAM."],
        "input": invalid_input, "settings": {"assembly": "GRCh38", "pam": "NGG", "max_mismatches": 1, "models": [1, 2, 3]},
        "expected_observations": ["The server rejects the missing-PAM input with HTTP 422 before creating a prediction job.", "The correction requires the actual three-base PAM, obtained from the intended reference locus or trusted input."],
        "provenance": {"sequence_origin": "First 20 nt of the public-reference walkthrough guide; deliberately incomplete for validation.", "note": common_note, "backend_release_id": health["release_id"]},
        "document_filename": None, "document_sha256": None, "completed_job": None, "expected_error": expected_error})
    manifest = {"schema_version": 1, "generated_at": generated, "note": common_note,
        "generator_sha256": sha256(Path(__file__)), "normal_source_document_sha256": sha256(args.normal_document),
        "staging_jobs_created_and_deleted": client.deleted_jobs, "scenarios": cases}
    args.output_dir.joinpath("manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"scenarios": len(cases), "result_counts": {case["id"]: case["completed_job"]["result_count"] for case in cases if case["kind"] == "result"}, "created_jobs_deleted": client.deleted_jobs, "output": str(args.output_dir)}))


if __name__ == "__main__":
    main()
