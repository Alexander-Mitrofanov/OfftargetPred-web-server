"""Public JSON API with private job capabilities and bounded admission."""
import csv
import io
import json
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError as SchemaError, field_validator

from . import __version__
from .config import Settings
from .jobs import ClientLimit, JobStore, NotFound, QueueFull, StorageFull
from .sequence import ValidationError, parse_guides, parse_pairs


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["pairs", "genome"]
    input: str = Field(min_length=1, max_length=5 * 1024 * 1024)
    format: Literal["csv", "tsv", "text", "fasta"] = "csv"
    models: list[Literal[1, 2, 3]] = Field(default_factory=lambda: [1], min_length=1, max_length=3)
    name: str = Field(default="", max_length=120)
    assembly: Literal["GRCh38"] = "GRCh38"
    max_mismatches: int = Field(default=3, ge=0, le=4, strict=True)

    @field_validator("models", mode="before")
    @classmethod
    def integer_models(cls, value):
        if not isinstance(value, list) or any(type(item) is not int for item in value):
            raise ValueError("Model IDs must be integers.")
        return value


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    store = JobStore(settings)
    app = FastAPI(title="CRISPert API", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_credentials=False, allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"], expose_headers=["Content-Disposition"], max_age=600)

    @app.middleware("http")
    async def privacy_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(NotFound)
    async def not_found(request, exception):
        return JSONResponse({"detail": "Job not found, expired, or access token invalid."}, status_code=404)

    async def authorized(request: Request, job_id: str):
        value = request.headers.get("authorization", "")
        if not value.startswith("Bearer ") or len(value) > 200:
            raise NotFound()
        return store.authorize(job_id, value[7:])

    @app.get("/api/v1/health")
    async def health():
        return {"status": "ok", "version": __version__, "release_id": settings.release_id, "worker": store.worker_status(), "configured_device": settings.device}

    @app.get("/api/v1/capabilities")
    async def capabilities():
        reference = settings.reference()
        return {"modes": ["pairs"] + (["genome"] if reference else []), "models": [{"id": k, "key": f"k{k}", "label": f"{k}-mer", "default": k == 1} for k in (1, 2, 3)], "default_models": [1], "limits": {"request_bytes": settings.max_request_bytes, "pairs": settings.max_pairs, "guides": settings.max_guides, "candidates": settings.max_candidates, "queued": settings.max_queued, "mismatches": 4}, "retention_hours": settings.retention_hours, "genomes": [{"id": "GRCh38", "label": reference.get("label", "Human GRCh38 primary assembly"), "source_url": reference.get("source_url"), "sha256": reference.get("sha256")}] if reference else [], "score_label": "CRISPert score", "calibrated": False, "pam": "NGG", "bulges": False, "worker": store.worker_status()}

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
                rows = parse_pairs(submission.input, format=submission.format)
                if len(rows) > settings.max_pairs:
                    raise HTTPException(422, f"At most {settings.max_pairs:,} pairs are accepted per job.")
                payload = {"mode": "pairs", "pairs": rows, "models": submission.models}
            else:
                if not settings.reference():
                    raise HTTPException(503, "Genome search is not configured on this server. Pair scoring is available.")
                rows = parse_guides(submission.input, format=submission.format)
                if len(rows) > settings.max_guides:
                    raise HTTPException(422, f"At most {settings.max_guides} guides are accepted per search.")
                payload = {"mode": "genome", "guides": rows, "models": submission.models, "assembly": submission.assembly, "max_mismatches": submission.max_mismatches}
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
        fields = ["id", "row_index", "guide_id", "target", "off_target", "chromosome", "position", "start", "end", "strand", "coordinate_system", "assembly", "mismatches", "pam_mismatches", "mismatch_positions", "unknown_positions", "exact_match", "protospacer_match", "warnings"] + [f"score_{key}" for key in model_keys]
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for item in rows:
            record = {field: item.get(field, "") for field in fields}
            record.update({f"score_{key}": item.get("scores", {}).get(key, "") for key in model_keys})
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
