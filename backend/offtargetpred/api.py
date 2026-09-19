"""Public JSON API with private job capabilities and bounded admission."""
import csv
import io
import json
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError as SchemaError, field_validator
from starlette.concurrency import run_in_threadpool

from . import __version__
from .config import Settings
from .input_metadata import normalize_input_metadata
from .jobs import ClientLimit, JobStore, NotFound, QueueFull, StorageFull
from .sequence import ValidationError, parse_guides, parse_pairs
from .tool_limits import ToolAdmission, ToolBusy


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["pairs", "genome"]
    input: str = Field(min_length=1, max_length=5 * 1024 * 1024)
    format: Literal["csv", "tsv", "text", "fasta"] = "csv"
    models: list[Literal[1, 2, 3]] = Field(default_factory=lambda: [1], min_length=1, max_length=3)
    name: str = Field(default="", max_length=120)
    assembly: Literal["GRCh38"] = "GRCh38"
    max_mismatches: int = Field(default=3, ge=0, le=4, strict=True)
    intended_loci: list[dict] = Field(default_factory=list, max_length=10)

    @field_validator("models", mode="before")
    @classmethod
    def integer_models(cls, value):
        if not isinstance(value, list) or any(type(item) is not int for item in value):
            raise ValueError("Model IDs must be integers.")
        return value


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    spacer: str = Field(min_length=20, max_length=20)
    chromosome: str = Field(min_length=1, max_length=100)
    start: int = Field(ge=0, strict=True)
    end: int = Field(gt=0, strict=True)
    assembly: Literal["GRCh38"] = "GRCh38"


class DiscoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chromosome: str = Field(min_length=1, max_length=200)
    start: int = Field(ge=0, strict=True)
    end: int = Field(gt=0, strict=True)
    assembly: Literal["GRCh38"] = "GRCh38"


class GeneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=100)
    assembly: Literal["GRCh38"] = "GRCh38"


class ContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    records: list[dict] = Field(min_length=1, max_length=20)
    flank_bases: int = Field(default=250, ge=0, le=1000, strict=True)


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    store = JobStore(settings)
    helper_admission = ToolAdmission(store.salt)
    app = FastAPI(title="CRISPert API", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_credentials=False, allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"], expose_headers=["Content-Disposition", "Retry-After"], max_age=600)

    @app.middleware("http")
    async def privacy_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(ToolBusy)
    async def tool_busy(request, exception):
        return JSONResponse({"detail": "Reference tools are busy. Please retry in a minute."}, status_code=429, headers={"Retry-After": "60"})

    @app.exception_handler(NotFound)
    async def not_found(request, exception):
        return JSONResponse({"detail": "Job not found, expired, or access token invalid."}, status_code=404)

    async def authorized(request: Request, job_id: str):
        value = request.headers.get("authorization", "")
        if not value.startswith("Bearer ") or len(value) > 200:
            raise NotFound()
        return store.authorize(job_id, value[7:])

    async def bounded_json(request: Request, schema, max_bytes: int = 8192):
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins:
            raise HTTPException(403, "Origin is not allowed.")
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise HTTPException(415, "Send application/json.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > max_bytes:
                raise HTTPException(413, "Request exceeds this tool's input-size limit.")
            body.extend(chunk)
        try:
            return schema.model_validate_json(body)
        except (SchemaError, ValueError):
            raise HTTPException(422, "Check the input fields, reference and coordinates.") from None

    def reference_path():
        reference = settings.reference()
        if not reference:
            raise HTTPException(503, "A verified local reference is unavailable.")
        return settings.genome_dir / reference["filename"], reference

    @app.post("/api/v1/resolve-guide")
    async def resolve(request: Request):
        from .reference import ReferenceUnavailable
        from .resolver import resolve_guide
        value = await bounded_json(request, ResolveRequest)
        fasta, reference = reference_path()
        try:
            with helper_admission.admit(request.client.host if request.client else "unknown"):
                return await run_in_threadpool(resolve_guide, fasta, reference, value.spacer, value.chromosome, value.start, value.end)
        except ValidationError as error:
            raise HTTPException(422, str(error)) from None
        except ReferenceUnavailable:
            raise HTTPException(503, "The verified reference index is unavailable. Full 23-nt guide input remains available.") from None

    @app.post("/api/v1/discover-guides")
    async def discover(request: Request):
        from .discovery import discover_guides
        from .reference import ReferenceUnavailable
        value = await bounded_json(request, DiscoveryRequest)
        fasta, reference = reference_path()
        try:
            with helper_admission.admit(request.client.host if request.client else "unknown"):
                return await run_in_threadpool(discover_guides, fasta, reference, value.chromosome, value.start, value.end)
        except ValidationError as error:
            raise HTTPException(422, str(error)) from None
        except ReferenceUnavailable:
            raise HTTPException(503, "The verified reference index is unavailable. Enter a complete 23-nt guide instead.") from None

    @app.post("/api/v1/discover-genes")
    async def genes(request: Request):
        from .discovery import lookup_genes
        from .annotations import AnnotationUnavailable
        value = await bounded_json(request, GeneRequest)
        _, reference = reference_path()
        if not settings.annotation_db:
            raise HTTPException(503, "Gene lookup is unavailable. Use a reference interval instead.")
        try:
            with helper_admission.admit(request.client.host if request.client else "unknown"):
                return await run_in_threadpool(lookup_genes, settings.annotation_db, reference, value.query)
        except ValidationError as error:
            raise HTTPException(422, str(error)) from None
        except AnnotationUnavailable:
            raise HTTPException(503, "Gene lookup is unavailable or exceeded its query limit. Use a reference interval instead.") from None

    @app.post("/api/v1/reference-context")
    async def context(request: Request):
        from .followup import reference_context
        from .reference import ReferenceUnavailable
        value = await bounded_json(request, ContextRequest, max_bytes=16_384)
        fasta, reference = reference_path()
        try:
            with helper_admission.admit(request.client.host if request.client else "unknown"):
                return await run_in_threadpool(reference_context, fasta, reference, value.records, value.flank_bases)
        except ValidationError as error:
            raise HTTPException(422, str(error)) from None
        except ReferenceUnavailable:
            raise HTTPException(503, "Verified reference sequence is unavailable. Retry when the reference tools are ready.") from None

    @app.get("/api/v1/health")
    async def health():
        return {"status": "ok", "version": __version__, "release_id": settings.release_id, "worker": store.worker_status(), "configured_device": settings.device}

    @app.get("/api/v1/capabilities")
    async def capabilities():
        from .cfd import cfd_metadata
        reference = settings.reference()
        resolver_available = False
        if reference:
            from .reference import ReferenceUnavailable, load_reference
            try:
                await run_in_threadpool(load_reference, settings.genome_dir / reference["filename"], reference)
                resolver_available = True
            except (ReferenceUnavailable, OSError):
                pass
        annotation = {"available": False}
        if settings.annotation_db and settings.annotation_db.is_file():
            try:
                manifest = json.loads(settings.annotation_db.with_suffix(".json").read_text())
                annotation = {"available": bool(reference and manifest.get("complete") and manifest.get("reference", {}).get("sha256") == reference.get("sha256")), "source": "Ensembl", "release": manifest.get("release"), "assembly": manifest.get("assembly")}
            except (OSError, ValueError, TypeError):
                pass
        return {
            "modes": ["pairs"] + (["genome"] if reference else []),
            "models": [{"id": k, "key": f"k{k}", "label": f"{k}-mer", "default": k == 1} for k in (1, 2, 3)],
            "default_models": [1],
            "limits": {"request_bytes": settings.max_request_bytes, "pairs": settings.max_pairs, "guides": settings.max_guides, "candidates": settings.max_candidates, "queued": settings.max_queued, "mismatches": 4},
            "retention_hours": settings.retention_hours,
            "genomes": [{"id": "GRCh38", "label": reference.get("label", "Human GRCh38 primary assembly"), "source_url": reference.get("source_url"), "sha256": reference.get("sha256")}] if reference else [],
            "score_label": "CRISPert score", "calibrated": False, "pam": "NGG", "bulges": False,
            "annotations": annotation, "baselines": {"cfd": cfd_metadata()},
            "features": {"guide_resolver": resolver_available, "guide_discovery": resolver_available, "gene_lookup": resolver_available and annotation["available"], "reference_context": resolver_available},
            "worker": store.worker_status(),
        }

    @app.post("/api/v1/jobs", status_code=202)
    async def submit(request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins:
            raise HTTPException(403, "Origin is not allowed.")
        if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            raise HTTPException(415, "Send application/json.")
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                length = int(content_length)
            except ValueError:
                raise HTTPException(400, "Invalid Content-Length.") from None
            if length < 0 or length > settings.max_request_bytes:
                raise HTTPException(413, "Request exceeds the 5 MiB limit.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > settings.max_request_bytes:
                raise HTTPException(413, "Request exceeds the 5 MiB limit.")
            body.extend(chunk)
        try:
            submission = Submission.model_validate_json(body)
        except (SchemaError, ValueError):
            raise HTTPException(422, "Invalid request. Check mode, input, format, model selection and mismatch limit.") from None
        if len(set(submission.models)) != len(submission.models):
            raise HTTPException(422, "Choose each model only once.")
        try:
            if submission.mode == "pairs":
                if submission.format == "fasta":
                    raise HTTPException(422, "Use CSV, TSV or paired plain text for pair scoring.")
                rows = normalize_input_metadata(parse_pairs(submission.input, format=submission.format))
                if len(rows) > settings.max_pairs:
                    raise HTTPException(422, f"At most {settings.max_pairs:,} pairs are accepted per job.")
                payload = {"mode": "pairs", "pairs": rows, "models": submission.models}
            else:
                if not settings.reference():
                    raise HTTPException(503, "Genome search is not configured on this server. Pair scoring is available.")
                rows = parse_guides(submission.input, format=submission.format)
                if len(rows) > settings.max_guides:
                    raise HTTPException(422, f"At most {settings.max_guides} guides are accepted per search.")
                intended = []
                for locus in submission.intended_loci:
                    if not isinstance(locus, dict) or set(locus) - {"target", "chromosome", "start", "end", "strand", "assembly"}:
                        raise HTTPException(422, "Invalid intended-locus record.")
                    if (locus.get("target") not in {g["target"] for g in rows} or type(locus.get("start")) is not int or type(locus.get("end")) is not int or locus["start"] < 0 or locus["end"] - locus["start"] != 23 or locus.get("strand") not in ("+", "-") or locus.get("assembly") != "GRCh38" or not isinstance(locus.get("chromosome"), str) or not 1 <= len(locus["chromosome"]) <= 100):
                        raise HTTPException(422, "Intended loci must match a submitted guide and a 23-base reference interval.")
                    intended.append(locus)
                payload = {"mode": "genome", "guides": rows, "models": submission.models, "assembly": submission.assembly, "max_mismatches": submission.max_mismatches, "intended_loci": intended}
        except ValidationError as error:
            raise HTTPException(422, str(error)) from None
        if not rows:
            raise HTTPException(422, "Provide at least one valid input row.")
        try:
            result = store.submit(payload, request.client.host if request.client else "unknown", submission.name)
        except QueueFull:
            raise HTTPException(429, "The queue is full. Please retry later.", headers={"Retry-After": "60"}) from None
        except ClientLimit:
            raise HTTPException(429, "One pending job per client and 30 submissions per hour are allowed.", headers={"Retry-After": "60"}) from None
        except StorageFull:
            raise HTTPException(503, "Storage reserve reached. Please retry later.") from None
        return result

    @app.get("/api/v1/jobs/{job_id}")
    async def status(row=Depends(authorized)):
        return store.public(row)

    def result_document(row):
        if row["status"] != "completed":
            raise HTTPException(409, "Results are available only after the job completes.")
        try:
            return json.loads((store.directory(row["id"]) / "results.json").read_text())
        except (OSError, ValueError):
            raise HTTPException(503, "Results are temporarily unavailable.") from None

    @app.get("/api/v1/jobs/{job_id}/results")
    async def results(offset: int = 0, limit: int = 100, q: str = "", sort: str = "input", order: str = "asc", row=Depends(authorized)):
        if offset < 0 or not 1 <= limit <= 1000 or len(q) > 120 or sort not in ("input", "k1", "k2", "k3", "mismatches") or order not in ("asc", "desc"):
            raise HTTPException(422, "Invalid pagination or sorting parameters.")
        document = result_document(row)
        rows = document["rows"]
        all_count = len(rows)
        if q:
            needle = q.casefold()
            fields = ("id", "guide_id", "target", "off_target", "chromosome")
            rows = [item for item in rows if any(needle in str(item.get(key, "")).casefold() for key in fields)]
        if sort != "input":
            def key(item):
                value = item.get("scores", {}).get(sort) if sort.startswith("k") else item.get("mismatches")
                return float(value) if value is not None else (-1 if order == "desc" else float("inf"))
            rows = sorted(rows, key=key, reverse=order == "desc")
        elif order == "desc":
            rows = list(reversed(rows))
        return {"total": len(rows), "unfiltered_total": all_count, "offset": offset, "limit": limit, "rows": rows[offset:offset + limit], "metadata": document.get("metadata", {})}

    @app.get("/api/v1/jobs/{job_id}/download")
    async def download(format: Literal["csv", "json"] = "csv", row=Depends(authorized)):
        document = result_document(row)
        if format == "json":
            return JSONResponse(document, headers={"Content-Disposition": 'attachment; filename="crispert-results.json"'})
        rows = document["rows"]
        model_keys = [f"k{k}" for k in json.loads(row["models"])]
        fields = ["id", "row_index", "guide_id", "target", "off_target", "chromosome", "position", "start", "end", "strand", "coordinate_system", "assembly", "mismatches", "pam_mismatches", "mismatch_positions", "unknown_positions", "exact_match", "protospacer_match", "warnings"] + [f"score_{key}" for key in model_keys] + ["cfd_score", "cfd_unavailable_reason", "gene_names", "gene_ids", "annotation_categories", "annotation_source", "annotation_release", "source_tool", "source_format", "source_id", "source_chromosome", "coordinate_verification"]
        fields += ["user_selected_locus", "sensitivity_schema", "sensitivity_panel", "sensitivity_original_candidate", "sensitivity_position", "sensitivity_base", "sensitivity_original_base", "sensitivity_source_id", "sensitivity_source_row"]
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for item in rows:
            record = {field: item.get(field, "") for field in fields}
            record.update({f"score_{key}": item.get("scores", {}).get(key, "") for key in model_keys})
            cfd = item.get("baselines", {}).get("cfd", {})
            annotation = item.get("annotations", {})
            features = annotation.get("features", [])
            record.update({
                "cfd_score": cfd.get("score") if cfd.get("score") is not None else "",
                "cfd_unavailable_reason": cfd.get("reason", ""),
                "gene_names": sorted({f["gene_name"] for f in features if f.get("gene_name")}),
                "gene_ids": sorted({f["gene_id"] for f in features if f.get("gene_id")}),
                "annotation_categories": annotation.get("categories", []),
                "annotation_source": annotation.get("source", ""),
                "annotation_release": annotation.get("release", ""),
            })
            # Spreadsheet software must not interpret submitted identifiers as formulas.
            for field, value in record.items():
                if isinstance(value, (list, dict)):
                    record[field] = json.dumps(value, separators=(",", ":"))
                    continue
                if field == "strand" and value in ("+", "-"):
                    continue
                if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                    record[field] = "'" + value
            writer.writerow(record)
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="crispert-results.csv"'})

    @app.post("/api/v1/jobs/{job_id}/cancel")
    async def cancel(row=Depends(authorized)):
        if row["status"] in ("completed", "failed", "cancelled"):
            return store.public(row)
        store.cancel(row["id"])
        return store.public(store.get(row["id"]))

    @app.delete("/api/v1/jobs/{job_id}", status_code=202)
    async def delete(row=Depends(authorized)):
        running = store.cancel(row["id"], delete=True)
        return {"id": row["id"], "status": "deleting" if running else "deleted"}

    return app


def main():
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=8010, access_log=False, proxy_headers=True, forwarded_allow_ips="127.0.0.1")


if __name__ == "__main__":
    main()
