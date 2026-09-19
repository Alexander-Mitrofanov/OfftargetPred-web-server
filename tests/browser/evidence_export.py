"""Browser-local assay import and ZIP preservation against a frozen public demo."""
import json
import os
import re
from pathlib import Path
import zipfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
URL = os.environ.get("OFFTARGETPRED_UI_URL", "http://127.0.0.1:5182/")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(URL.rstrip("/") + "/#examples")
        page.get_by_role("button", name=re.compile("^Explore results")).first.click()
        page.get_by_role("heading", name="Explore example results", exact=True).wait_for()
        sequences = page.locator(".analysis-table tbody tr").first.locator("code").all_text_contents()
        target, candidate = sequences[:2]
        text = f"target,off_target,value\n{target},{candidate},12\n{target},{candidate},12\n{'C'*20}AGG,{'C'*20}AGG,0"
        page.locator(".assay-evidence > summary").click()
        page.get_by_label("Assay name", exact=True).fill("Synthetic browser test")
        page.get_by_label("Or paste the observation table", exact=True).fill(text)
        page.get_by_role("button", name="Preview observation matches", exact=True).click()
        page.get_by_role("button", name="Apply 3 observations", exact=True).click()
        page.get_by_text("3 observations applied", exact=True).wait_for()
        page.locator(".analysis-exports > summary").click()
        with page.expect_download() as download:
            page.get_by_role("button", name="Download full analysis ZIP", exact=True).click()
        with zipfile.ZipFile(download.value.path()) as archive:
            assert archive.testzip() is None
            evidence = json.loads(archive.read("experimental-evidence.json"))
            assert len(evidence["observations"]) == 3
            assert evidence["observations"][1]["duplicate_of"] == "observation-1"
            assert evidence["observations"][2]["status"] == "unmatched"
            assert evidence["metadata"]["hash_status"] == "available"
            document = json.loads(archive.read("results-full.json"))
            assert document["metadata"]["experimental_evidence"]["file"] == "experimental-evidence.json"
            assert len(document["rows"]) == 15
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not errors, errors
        browser.close()
    print("Assay preview/apply, duplicate/unmatched preservation, SHA256, ZIP CRC and mobile layout passed.")


if __name__ == "__main__":
    main()
