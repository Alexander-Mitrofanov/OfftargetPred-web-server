"""Regression checks for the simplified Predict UI using isolated API fixtures."""
import argparse
import csv
import io
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

JOB = "4fb93f5c-1a21-4607-84bc-95a72dfb03d1"
TOKEN = "A" * 40 + "_-A"
GUIDE = "GATGCTCTCCAGAATCACTGCGG"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5194/")
    parser.add_argument("--executable", default="/opt/google/chrome/chrome")
    args = parser.parse_args()
    assert urlparse(args.url).hostname in {"localhost", "127.0.0.1"}
    rows = [dict(id=f"candidate-{i + 1}", row_index=i + 1, guide_id="guide-1", target=GUIDE,
                 off_target=GUIDE[:20] + "AGG", scores={"k1": 1 - i / 100},
                 mismatches=0, mismatch_positions=[21], pam_mismatches=1,
                 baselines={"cfd": {"score": 1}}) for i in range(30)]
    # Keep actual spacer and terminal PAM differences visible.
    rows[1].update(off_target="A" + GUIDE[1:20] + "AAA", mismatches=1,
                   mismatch_positions=[1, 21, 22, 23], pam_mismatches=3)
    document = {"rows": rows, "metadata": {"mode": "genome", "max_mismatches": 6}}
    capabilities = dict(modes=["pairs", "genome"], models=[{"id": 1, "key": "k1", "label": "k=1"}],
                        default_models=[1], limits=dict(request_bytes=5242880, pairs=60000, guides=10, candidates=50000, queued=20),
                        retention_hours=24, genomes=[{"id": "GRCh38", "label": "Human GRCh38"}],
                        score_label="CRISPert score", calibrated=False, features={}, worker={"available": True})
    job = dict(id=JOB, status="complete", mode="genome", models=[1], created_at="2026-09-22T10:00:00Z",
               expires_at="2030-01-01T12:00:00Z", result_count=len(rows))
    submissions, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.executable, headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page.on("pageerror", lambda error: errors.append(str(error)))

        def fixture(route):
            path = urlparse(route.request.url).path
            if path.endswith("/capabilities"):
                body = capabilities
            elif route.request.method == "POST" and path.endswith("/jobs"):
                submissions.append(route.request.post_data_json)
                route.fulfill(status=202, json={**job, "token": TOKEN})
                return
            elif path.endswith("/download"):
                body = document
            elif path.endswith(JOB):
                body = job
            else:
                raise AssertionError(f"Unexpected API request: {path}")
            route.fulfill(json=body)

        page.route("**/api/v1/**", fixture)
        page.goto(args.url)
        page.wait_for_load_state("networkidle")
        expect(page.locator(".site-header a")).to_have_count(0)
        expect(page.locator(".guide-panel")).to_have_count(0)
        expect(page.get_by_text("Pair limit: 60,000 per job.", exact=True)).to_be_visible()
        expect(page.locator('a[href*="github.com/Alexander-Mitrofanov/OfftargetPred-web-server"]')).to_have_count(0)
        expect(page.get_by_role("link", name="API reference", exact=True)).to_have_count(0)
        expect(page.get_by_role("link", name="Python client and runnable example")).to_have_count(0)
        # Inspect the rendered form before exercising its controls.
        expect(page.get_by_role("button", name="Genome search Find sites for my guides")).to_be_visible()
        page.get_by_role("button", name="Genome search Find sites for my guides").click()
        expect(page.get_by_text("Have a 20-nt spacer?", exact=False)).to_have_count(0)
        mismatch = page.get_by_role("combobox", name="Maximum mismatches")
        assert mismatch.locator("option").all_text_contents() == list("0123456")
        mismatch.select_option("6")
        page.get_by_label("Guide sequences", exact=False).fill(GUIDE)
        page.get_by_role("button", name="Find and score candidates", exact=True).click()
        expect(page.get_by_role("heading", name="Your analysis", exact=True)).to_be_visible()
        expect(page.locator(".analysis-table tbody tr")).to_have_count(25)
        assert submissions[0]["max_mismatches"] == 6
        for selector in [".guide-overview-scientific", ".model-comparison", ".shortlist-builder", ".genome-context", ".followup-preparation", ".assay-evidence", ".sequence-sensitivity"]:
            expect(page.locator(selector)).to_have_count(0)
        expect(page.get_by_role("heading", name="Return to this analysis", exact=True)).to_be_visible()
        expect(page.locator(".analysis-provenance")).to_have_count(0)
        expect(page.get_by_label("Show CFD baseline")).to_have_count(0)
        expect(page.get_by_role("columnheader", name="CFD", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Save analysis", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="JSON & metadata", exact=True)).to_have_count(0)
        first, second = page.locator(".analysis-table tbody tr").nth(0), page.locator(".analysis-table tbody tr").nth(1)
        expect(first.locator(".analysis-mismatch")).to_have_count(0)
        expect(first.get_by_role("img", name=re.compile("Candidate .*Differing positions: none"))).to_be_visible()
        expect(second.get_by_text("Differing positions: 1, 22, 23", exact=True)).to_be_visible()
        expect(second.locator(".analysis-mismatch")).to_have_count(3)
        for row in [first, second]:
            assert "analysis-mismatch" not in row.locator(".analysis-alignment code").nth(1).locator("span").nth(20).get_attribute("class")
        page.get_by_role("button", name="Next", exact=True).click()
        expect(page.locator(".analysis-table tbody tr")).to_have_count(5)
        page.get_by_role("searchbox", name="Find candidates").fill("candidate-30")
        expect(page.locator(".analysis-table tbody tr")).to_have_count(1)
        expect(page.locator(".analysis-count")).to_contain_text("1 of 30")
        page.get_by_role("link", name="Help & About", exact=True).click()
        expect(page.get_by_role("heading", name="Help & About", exact=True)).to_be_visible()
        expect(page.locator('a[href="#examples"], a[href="#evidence"]')).to_have_count(0)
        page.goto(args.url + "#about")
        expect(page.get_by_role("heading", name="Help & About", exact=True)).to_be_visible()
        page.get_by_role("link", name="Back to prediction", exact=True).click()
        expect(page.get_by_role("searchbox", name="Find candidates")).to_have_value("candidate-30")
        with page.expect_download() as download:
            page.get_by_role("button", name="Download results CSV", exact=True).click()
        assert download.value.suggested_filename.endswith(".csv")
        exported = list(csv.DictReader(io.StringIO(Path(download.value.path()).read_text())))
        assert len(exported) == 30, "CSV must include rows beyond search and pagination"
        assert json.loads(exported[0]["mismatch_positions"]) == []
        assert json.loads(exported[1]["mismatch_positions"]) == [1, 22, 23]
        assert exported[1]["pam_mismatches"] == "2"
        assert exported[0]["off_target"] == rows[0]["off_target"]
        page.get_by_role("button", name="Reset filters", exact=True).click()
        page.get_by_role("combobox", name=re.compile("^Sort by")).select_option("mismatches")
        expect(page.locator(".analysis-table tbody tr").first).to_contain_text("candidate-2")
        for width in [390, 320]:
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Overflow at {width}px"
        page.screenshot(path="/tmp/offtarget-simplified-mobile.png", full_page=True)
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.screenshot(path="/tmp/offtarget-simplified-desktop.png", full_page=True)
        for old_hash in ["examples", "evidence"]:
            page.goto(args.url + "#" + old_hash)
            expect(page.get_by_role("heading", name="New prediction", exact=True)).to_be_visible()
            expect(page.get_by_role("heading", name="Your analysis", exact=True)).to_be_visible()
        assert not errors, errors
        browser.close()
    print("PASS: navigation, six-mismatch submission, removed controls, PAM differences, pagination, filtering, sorting, complete CSV, recovery and mobile layout; no browser errors.")


if __name__ == "__main__":
    main()
