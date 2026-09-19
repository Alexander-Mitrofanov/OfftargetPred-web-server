"""Actual local reference flanks and downloads; no inference jobs or external requests."""
import argparse
import hashlib
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5182/")
    parser.add_argument("--artifacts", type=Path, default=Path("/tmp/offtargetpred-reference-flanks"))
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    expect.set_options(timeout=30_000)
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "frontend/public/demonstrations/manifest.json").read_text())
    case = next(case for case in manifest["scenarios"] if case["id"] == "reference-walkthrough")
    demo = json.loads((root / "frontend/public/demonstrations" / case["document_filename"]).read_text())
    rows = [next(row for row in demo["rows"] if row["strand"] == strand) for strand in ("+", "-")]
    checks = []
    with sync_playwright() as playwright:
        for engine in ("chromium", "firefox"):
            browser = getattr(playwright, engine).launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 1000}, accept_downloads=True)
            page.set_default_timeout(30_000)
            posts, errors = [], []
            page.on("request", lambda request: posts.append(request.url) if request.method == "POST" else None)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url.rstrip("/") + "/#examples")
            page.get_by_role("button", name=re.compile("^Explore results")).first.click()
            page.get_by_role("heading", name="Explore example results", exact=True).wait_for()
            panel = page.locator(".followup-preparation")
            panel.locator(":scope > summary").focus()
            page.keyboard.press("Enter")
            prepare = panel.get_by_role("button", name="Prepare selected reference flanks", exact=True)
            expect(prepare).to_be_disabled()
            for row in rows:
                page.get_by_role("checkbox", name=f"Select candidate {row['id']}, row {row['row_index']}", exact=True).check()
            expect(prepare).to_be_enabled()
            expect(panel).to_contain_text("2 rows selected")
            assert not posts, posts
            with page.expect_response(lambda response: response.url.endswith("/reference-context")) as response:
                prepare.click()
            assert response.value.status == 200
            document = response.value.json()
            assert document["summary"] == {"selected": 2, "ready": 2, "skipped": 0}
            assert {entry["candidate"]["strand"] for entry in document["records"]} == {"+", "-"}
            expect(panel).to_contain_text("2 reference-verified sequences prepared; 0 selected rows skipped")
            expect(panel).to_contain_text("not validated primers or amplicons")
            for button, suffix in (("Download reference FASTA", "fasta"), ("Download flank metadata JSON", "json")):
                with page.expect_download() as download:
                    panel.get_by_role("button", name=button, exact=True).click()
                path = args.artifacts / f"reference-flanks-{engine}.{suffix}"
                download.value.save_as(path)
                assert download.value.suggested_filename == f"offtargetpred-reference-flanks.{suffix}"
                if suffix == "fasta":
                    assert hashlib.sha256(path.read_bytes()).hexdigest() == document["fasta_sha256"]
                else:
                    metadata = json.loads(path.read_text())
                    assert metadata["records"] == document["records"] and "fasta" not in metadata
                    assert "token" not in path.read_text()
            for width in (390, 320):
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}"
            panel.screenshot(path=str(args.artifacts / f"reference-flanks-{engine}-320.png"))
            # An input change invalidates old downloads and never fetches silently.
            panel.get_by_label("Flank length per side · bases", exact=True).fill("1001")
            expect(panel.get_by_role("button", name="Download reference FASTA")).to_have_count(0)
            prepare.click()
            expect(panel.get_by_role("alert")).to_contain_text("0 to 1,000")
            assert len(posts) == 1 and posts[0].endswith("/reference-context"), posts
            panel.get_by_label("Flank length per side · bases", exact=True).fill("0")
            with page.expect_response(lambda response: response.url.endswith("/reference-context")) as zero_response:
                panel.get_by_label("Flank length per side · bases", exact=True).press("Enter")
            assert zero_response.value.status == 200
            assert all(len(entry["context"]["sequence"]) == 23 for entry in zero_response.value.json()["records"])
            page.get_by_role("checkbox", name=f"Select candidate {rows[0]['id']}, row {rows[0]['row_index']}", exact=True).uncheck()
            expect(panel.get_by_role("button", name="Download reference FASTA")).to_have_count(0)
            assert len(posts) == 2 and not errors, (posts, errors)
            # Controlled request fixture: emulate an imported row whose declared
            # sequence disagrees with its coordinates. The real API performs the
            # mismatch check; no canned response is substituted.
            def mismatch_fixture(route):
                body = route.request.post_data_json
                site = body["records"][0]["off_target"]
                body["records"][0]["off_target"] = ("A" if site[0] != "A" else "C") + site[1:]
                route.continue_(post_data=json.dumps(body))

            page.route("**/reference-context", mismatch_fixture)
            with page.expect_response(lambda response: response.url.endswith("/reference-context")) as mismatch:
                prepare.click()
            mismatch_document = mismatch.value.json()
            assert mismatch_document["summary"] == {"selected": 1, "ready": 0, "skipped": 1}
            assert mismatch_document["records"][0]["reason_code"] == "reference_sequence_mismatch"
            expect(panel).to_contain_text("does not exactly match this reference locus")
            expect(panel.get_by_role("button", name="Download reference FASTA")).to_be_disabled()
            expect(panel.get_by_role("button", name="Download flank metadata JSON")).to_be_enabled()
            assert len(posts) == 3 and not errors, (posts, errors)
            checks.append({"browser": engine, "passed": True, "reference_strands": ["+", "-"],
                           "fasta_hash_verified": True, "metadata_preserved": True, "zero_flank": True,
                           "explicit_requests_only": True, "stale_downloads_cleared": True,
                           "controlled_mismatch_skipped_by_real_api": True,
                           "mobile_390_and_320": True, "page_errors": errors})
            browser.close()
    print(json.dumps(checks, indent=2))


if __name__ == "__main__":
    main()
