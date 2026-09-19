"""Exercise public examples with every prediction API request blocked.

Run against the coordinator's isolated staging frontend, not production:
  PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
    /srv/crispert/staging/test-venv/bin/python tests/browser_examples.py
"""

import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlparse
import zipfile

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5182/")
    parser.add_argument("--browser", choices=["chromium", "firefox"], default="chromium")
    parser.add_argument("--output", default="output/examples-browser")
    args = parser.parse_args()
    if urlparse(args.url).hostname not in {"localhost", "127.0.0.1"}:
        parser.error("Only an isolated localhost frontend is supported.")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        page = context.new_page()
        api_requests = []
        asset_requests = []
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def block_api(route):
            api_requests.append({"url": route.request.url, "method": route.request.method})
            route.abort()

        context.route("**/api/v1/**", block_api)
        page.on("request", lambda request: asset_requests.append(request.url) if "/demonstrations/" in request.url else None)
        def choose_example(title):
            page.locator(".example-card").filter(has=page.get_by_role("heading", name=title, exact=True)).get_by_role("button").click()

        fail_once = {"manifest": True, "result": True}

        def manifest_asset(route):
            if fail_once["manifest"]:
                fail_once["manifest"] = False
                route.fulfill(status=503, body="Temporary example asset failure")
            else:
                route.continue_()

        def result_asset(route):
            if fail_once["result"]:
                fail_once["result"] = False
                route.fulfill(status=200, content_type="application/json", body="{}")
            else:
                route.continue_()

        context.route("**/demonstrations/manifest.json", manifest_asset)
        context.route("**/demonstrations/reference-walkthrough.json", result_asset)
        page.goto(args.url.rstrip("/") + "/#examples")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="Explore before you run")).to_be_visible()
        expect(page.get_by_role("alert")).to_contain_text("HTTP 503")
        page.get_by_role("button", name="Retry example library").click()
        expect(page.locator(".example-card")).to_have_count(4)
        page.screenshot(path=str(output / f"{args.browser}-library.png"), full_page=True)

        choose_example("Explore a public reference guide")
        expect(page.locator("#example-detail-title")).to_be_focused()
        expect(page.get_by_role("alert")).to_contain_text("checksum")
        page.get_by_role("button", name="Retry example results").click()
        expect(page.locator(".analysis-count")).to_contain_text("15 of 15 candidates shown; 0 selected")
        expect(page.get_by_text("Recorded file checksum verified.")).to_be_visible()
        expect(page.get_by_role("button", name="Delete job and data")).to_have_count(0)
        page.get_by_role("checkbox", name="Select candidate candidate-1, row 1", exact=True).check()
        expect(page.locator(".analysis-count")).to_contain_text("1 selected")
        page.get_by_role("checkbox", name="Show CFD baseline").check()
        expect(page.locator(".analysis-table th", has_text="CFD")).to_have_count(1)
        page.get_by_text("Scientific filters", exact=True).click()
        page.get_by_label("Full-sequence exact matches").select_option("only")
        expect(page.locator(".analysis-count")).to_contain_text("5 of 15 candidates shown")
        page.get_by_role("button", name="Reset filters", exact=True).click()

        page.get_by_text("Download an analysis package or shortlist", exact=True).click()
        with page.expect_download() as download:
            page.get_by_role("button", name="Download full analysis ZIP", exact=True).click()
        archive = output / f"{args.browser}-example-analysis.zip"
        download.value.save_as(archive)
        with zipfile.ZipFile(archive) as bundle:
            assert bundle.testzip() is None
            result = json.loads(bundle.read("results-full.json"))
            assert len(result["rows"]) == 15
            assert result["metadata"]["max_mismatches"] == 1
            assert len(result["metadata"]["intended_loci"]) == 1

        choose_example("Understand multiple exact matches")
        expect(page.locator(".analysis-count")).to_contain_text("13 of 13 candidates shown; 0 selected")
        expect(page.get_by_text("5 candidates also match the full 23 nt guide-associated sequence; other sites differ in the first PAM base.")).to_be_visible()
        page.get_by_role("button", name="Use this input in a new analysis").click()
        expect(page.locator("#genome-guides")).to_have_value("TGAGACTCTTGCAGTCACACAGG")
        expect(page.get_by_label("Maximum mismatches")).to_have_value("0")
        expect(page).to_have_url(re.compile(r"#predict$"))
        page.get_by_role("link", name="Examples", exact=True).click()

        choose_example("Interpret a completed search with no hits")
        expect(page.locator(".analysis-count")).to_contain_text("0 of 0 candidates shown; 0 selected")
        expect(page.locator(".guide-overview-counts")).to_contain_text("Submitted guides")
        submitted = page.locator(".guide-overview-counts > div").filter(has_text="Submitted guides")
        expect(submitted.locator("dd")).to_have_text("1")
        expect(page.locator(".analysis-table tbody")).to_contain_text("No sites were returned within this analysis scope")

        choose_example("Fix a guide with a missing PAM")
        expect(page.get_by_role("heading", name="Observed input error · HTTP 422")).to_be_visible()
        expect(page.locator(".example-validation")).to_contain_text("got 20")
        expect(page.locator(".analysis-workspace")).to_have_count(0)
        page.get_by_role("button", name="Use this input in a new analysis").click()
        expect(page.locator("#genome-guides")).to_have_value("TGAGACTCTTGCAGTCACAC")
        page.get_by_role("link", name="Examples", exact=True).click()

        choose_example("Explore a public reference guide")
        expect(page.locator(".analysis-count")).to_contain_text("15 of 15 candidates shown; 0 selected")
        assert sum(url.endswith("reference-walkthrough.json") for url in asset_requests) == 2, asset_requests
        # The first request deliberately failed; page navigation reuses the verified module cache.
        assert sum(url.endswith("manifest.json") for url in asset_requests) == 2, asset_requests
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#example-detail-title").scroll_into_view_if_needed()
        page.screenshot(path=str(output / f"{args.browser}-mobile-example.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "Unexpected page overflow on mobile"
        assert not any(request["method"] != "GET" for request in api_requests), api_requests
        assert not errors, errors
        (output / f"{args.browser}-checks.json").write_text(json.dumps({
            "browser": args.browser,
            "checks": ["API unavailable", "manifest retry", "checksum mismatch retry", "four scenarios", "complete counts", "filtering and selection", "local ZIP export", "prefill preserves settings", "invalid input has no score", "module cache", "mobile overflow", "no JavaScript errors", "no API submissions"],
            "api_requests": api_requests, "static_asset_requests": asset_requests,
        }, indent=2) + "\n")
        browser.close()
        print(f"Examples browser checks passed: {args.browser}; evidence in {output}")


if __name__ == "__main__":
    main()
