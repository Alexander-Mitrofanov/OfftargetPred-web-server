"""Private, browser-local context inspection using a frozen public result."""
import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5182/")
    parser.add_argument("--artifacts", type=Path, default=Path("/tmp/offtargetpred-genome-context"))
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        for engine in ("chromium", "firefox"):
            browser = getattr(playwright, engine).launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.set_default_timeout(10_000)
            errors, viewer_requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if "same key" in message.text or "Each child in a list" in message.text else None)
            page.route("**/api/v1/**", lambda route: route.abort())
            page.goto(args.url.rstrip("/") + "/#examples")
            page.get_by_role("button", name=re.compile("^Explore results")).first.click()
            page.get_by_role("heading", name="Explore example results", exact=True).wait_for()
            page.wait_for_load_state("networkidle")
            panel = page.locator(".genome-context")
            expect(panel).to_have_count(1)
            expect(panel.locator("svg")).to_have_count(0)
            page.on("request", lambda request: viewer_requests.append(request.url))
            panel.locator(":scope > summary").focus()
            page.keyboard.press("Enter")
            expect(panel.get_by_role("img", name="Candidate-centered GRCh38 genomic context")).to_be_visible()
            expect(panel).to_contain_text("not a complete regional gene track")
            expect(panel).to_contain_text("does not check whether an imported candidate sequence matches the reference")
            expect(panel).to_contain_text("1-based, inclusive")
            expect(panel).to_contain_text("0-based, half-open")
            panel.get_by_label("Focal candidate", exact=True).select_option("6")
            expect(panel).to_contain_text("the first 12 features")
            panel.locator(".genome-context-figure").screenshot(path=str(args.artifacts / f"genome-context-{engine}-diagram.png"))
            panel.get_by_text(re.compile(r"^Focal-site feature table")).click()
            feature_table = panel.get_by_role("region", name="Focal-site annotation features, scroll for all columns")
            expect(feature_table.locator("tbody tr")).to_have_count(20)
            panel.get_by_role("button", name="Next annotation features", exact=True).click()
            expect(panel.locator(".genome-context-pager")).to_contain_text("21–40")
            panel.get_by_role("button", name="Next annotation features", exact=True).click()
            expect(feature_table).to_contain_text("inferred exon gap")
            panel.get_by_label("Flank on each side", exact=True).select_option("100")
            expect(panel.locator(".genome-context-pager")).to_contain_text("1–20")
            panel.get_by_label("Find a focal candidate", exact=True).fill("candidate-5")
            expect(panel).to_contain_text("1 matching candidates")
            panel.get_by_label("Focal candidate", exact=True).select_option("4")
            expect(panel).to_contain_text("no gene or transcript overlap")
            expect(panel).to_contain_text("does not classify the surrounding window")
            # Parent updates must preserve one viewer and its focus. Equal keys on
            # sibling panels previously made React retain duplicate DOM nodes.
            page.locator(".analysis-table tbody tr").first.get_by_role("checkbox").check()
            expect(panel).to_have_count(1)
            expect(panel.get_by_label("Focal candidate", exact=True)).to_have_value("4")
            sequence_codes = page.locator(".analysis-table tbody tr").first.locator("code").all_text_contents()
            page.locator(".assay-evidence > summary").click()
            page.get_by_label("Assay name", exact=True).fill("Viewer state regression check")
            page.get_by_label("Or paste the observation table", exact=True).fill(f"target,off_target,value\n{sequence_codes[0]},{sequence_codes[1]},2")
            page.get_by_role("button", name="Preview observation matches", exact=True).click()
            page.get_by_role("button", name="Apply 1 observations", exact=True).click()
            expect(panel).to_have_count(1)
            expect(panel.get_by_label("Focal candidate", exact=True)).to_have_value("4")
            for width in (390, 320):
                page.set_viewport_size({"width": width, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}px"
                expect(panel.get_by_label("Focal candidate", exact=True)).to_be_visible()
            panel.screenshot(path=str(args.artifacts / f"genome-context-{engine}-320.png"))
            assert not viewer_requests, viewer_requests
            panel.locator(":scope > summary").click()
            expect(panel.locator("svg")).to_have_count(0)
            page.get_by_role("button", name=re.compile("Explore results.*Interpret a completed search with no hits")).click()
            page.get_by_role("heading", name="Explore example results", exact=True).wait_for()
            page.locator(".genome-context > summary").click()
            expect(page.locator(".genome-context")).to_contain_text("This analysis has no candidate sites to display")
            assert not errors, errors
            results.append({"browser": engine, "passed": True, "checks": ["API offline", "keyboard expansion", "lazy body", "real annotated demonstration", "feature diagram cap and table pagination", "coordinate and imported-sequence distinctions", "intergenic focal scope", "unique panel and focus preserved after selection/evidence state updates", "390px and 320px without page overflow", "no viewer network requests", "empty result", "no page errors"]})
            browser.close()
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
