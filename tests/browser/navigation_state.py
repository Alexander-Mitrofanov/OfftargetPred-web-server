"""Keep browser-local analysis work across Help/navigation; no live job is created."""
from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
from urllib.parse import urlparse
import zipfile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
JOB = "4fb93f5c-1a21-4607-84bc-95a72dfb03d1"
TOKEN = "A" * 40 + "_-A"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5182/")
    parser.add_argument("--browser", choices=["chromium", "firefox"], default="chromium")
    args = parser.parse_args()
    if urlparse(args.url).hostname not in {"localhost", "127.0.0.1"}:
        parser.error("Use isolated localhost staging for the synthetic recovery fixture.")
    document = json.loads((ROOT / "frontend/public/demonstrations/reference-walkthrough.json").read_text())
    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        headers = {"Access-Control-Allow-Origin": args.url.rstrip("/"), "Access-Control-Allow-Headers": "authorization, content-type"}

        def fixture(route):
            assert route.request.method in {"OPTIONS", "GET"}
            body = document if "/download" in route.request.url else {
                "id": JOB, "status": "complete", "mode": "genome", "models": [1, 2, 3],
                "created_at": "2026-09-19T10:00:00Z", "expires_at": "2030-01-01T12:00:00Z", "result_count": 15,
            }
            route.fulfill(status=204 if route.request.method == "OPTIONS" else 200,
                          headers=headers, content_type="application/json", body=json.dumps(body))

        context.route(f"**/api/v1/jobs/{JOB}**", fixture)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url.rstrip("/") + f"/#job={JOB}&token={TOKEN}")
        expect(page.get_by_role("heading", name="Your analysis", exact=True)).to_be_visible()

        for destination in ["Predict", "Examples"]:
            if destination == "Examples":
                page.get_by_role("link", name="Examples", exact=True).click()
                page.get_by_role("button", name="Explore results", exact=False).first.click()
            workspace = page.locator(".analysis-workspace:visible")
            expect(workspace.locator(".analysis-count")).to_contain_text("15 of 15")
            workspace.locator(".shortlist-builder > summary").click()
            workspace.get_by_role("button", name="Replace selection with proposal", exact=True).click()
            selected_before = workspace.locator(".analysis-table input[type=checkbox]:checked").count()
            assert selected_before > 0
            sequence = document["rows"][0]
            workspace.locator(".assay-evidence > summary").click()
            workspace.get_by_label("Assay name", exact=True).fill("Navigation regression")
            workspace.get_by_label("Or paste the observation table", exact=True).fill(
                f"target,off_target,value\n{sequence['target']},{sequence['off_target']},12"
            )
            workspace.get_by_role("button", name="Preview observation matches", exact=True).click()
            workspace.get_by_role("button", name="Apply 1 observations", exact=True).click()
            expect(workspace.get_by_text("1 observations applied", exact=True)).to_be_visible()
            workspace.get_by_role("link", name="Interpretation guide", exact=True).click()
            expect(page.get_by_role("heading", name="Two aligned sequences, 23 bases each", exact=True)).to_be_visible()
            assert page.locator(".analysis-workspace:visible").count() == 0
            page.get_by_role("link", name="About", exact=True).click()
            page.get_by_role("link", name=destination, exact=True).click()
            workspace = page.locator(".analysis-workspace:visible")
            expect(workspace).to_be_visible()
            expect(workspace.locator(".analysis-table input[type=checkbox]:checked")).to_have_count(selected_before)
            expect(workspace.get_by_text("1 observations applied", exact=True)).to_be_visible()
            workspace.locator(".analysis-exports > summary").click()
            with page.expect_download() as download:
                workspace.get_by_role("button", name="Download full analysis ZIP", exact=True).click()
            with zipfile.ZipFile(download.value.path()) as archive:
                assert archive.testzip() is None
                evidence = json.loads(archive.read("experimental-evidence.json"))
                assert len(evidence["observations"]) == 1
                selected = list(csv.DictReader(io.StringIO(archive.read("shortlist-selected.csv").decode())))
                assert len(selected) == selected_before
                notes = json.loads(archive.read("selection-notes.json"))
                assert any(entry["notes"] for entry in notes["rows"])
        assert not errors, errors
        browser.close()
    print(f"{args.browser}: Predict and Examples preserve selected candidates, rule reasons and observations through Help/About navigation and ZIP export.")


if __name__ == "__main__":
    main()
