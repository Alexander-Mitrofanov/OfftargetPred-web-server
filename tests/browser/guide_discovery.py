"""Real local annotation/reference flow; never creates a prediction job."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:5182/")
parser.add_argument("--artifacts", type=Path, default=Path("/tmp/offtargetpred-guide-discovery"))
args = parser.parse_args()
args.artifacts.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=30_000)
checks = []
with sync_playwright() as playwright:
    for engine in ("chromium", "firefox"):
        browser = getattr(playwright, engine).launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 1000})
        page.set_default_timeout(30_000)
        posts, errors = [], []
        page.on("request", lambda request: posts.append(request.url) if request.method == "POST" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.get_by_role("button", name="Genome search Find sites for my guides").click()
        page.get_by_text("Start from a gene or genomic region", exact=True).click()
        panel = page.locator(".guide-discovery")
        expect(panel.get_by_role("button", name="Find gene or transcript", exact=True)).to_be_enabled()
        panel.get_by_label("Exact gene name or Ensembl identifier", exact=True).fill("TP53")
        with page.expect_response(lambda response: response.url.endswith("/discover-genes")) as lookup:
            panel.get_by_label("Exact gene name or Ensembl identifier", exact=True).press("Enter")
        gene = lookup.value.json()
        assert lookup.value.status == 200 and gene["matches"][0]["gene_id"] == "ENSG00000141510"
        expect(panel).to_contain_text("This interval exceeds 20,000 bases")
        panel.get_by_role("button", name="Use this gene interval").click()
        expect(panel.get_by_label("Start · 1-based", exact=True)).to_have_value(str(gene["matches"][0]["start"] + 1))
        panel.get_by_role("button", name="Discover NGG guides", exact=True).click()
        expect(panel.get_by_role("alert")).to_contain_text("23–20,000 bases")
        first = gene["matches"][0]["start"]
        panel.get_by_label("End · inclusive", exact=True).fill(str(first + 20_000))
        with page.expect_response(lambda response: response.url.endswith("/discover-guides")) as over:
            panel.get_by_role("button", name="Discover NGG guides", exact=True).click()
        assert over.value.status == 422
        expect(panel.get_by_role("alert")).to_contain_text("more than 200")
        expect(panel.locator("tbody tr")).to_have_count(0)
        panel.get_by_label("End · inclusive", exact=True).fill(str(first + 500))
        with page.expect_response(lambda response: response.url.endswith("/discover-guides")) as discovery:
            panel.get_by_label("End · inclusive", exact=True).press("Enter")
        document = discovery.value.json()
        assert discovery.value.status == 200 and document["scope"]["complete"]
        assert {guide["strand"] for guide in document["guides"]} == {"+", "-"}
        expect(panel.locator("tbody tr")).to_have_count(len(document["guides"]))
        expect(panel.get_by_role("button", name="Use selected reference guide")).to_be_disabled()
        for strand in ("+", "-"):
            index = next(i for i, guide in enumerate(document["guides"]) if guide["strand"] == strand)
            guide = document["guides"][index]
            panel.get_by_role("radio").nth(index).check()
            panel.get_by_role("button", name="Use selected reference guide").click()
            assert guide["target23"] in page.locator("#genome-guides").input_value()
        expect(page.get_by_text("2 selected reference loci will be marked in results.", exact=False)).to_be_visible()
        for width in (390, 320):
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Page overflow at {width}"
        page.screenshot(path=str(args.artifacts / f"guide-discovery-{engine}-320.png"), full_page=True)
        assert all(url.endswith(("/discover-genes", "/discover-guides")) for url in posts), posts
        assert len(posts) == 3, posts
        assert not errors, errors
        checks.append({"browser": engine, "gene": "TP53", "interval_bases": 500,
                       "guides": len(document["guides"]), "both_strands": True,
                       "large_span_and_site_limit_rejected": True, "no_prediction_submitted": True,
                       "mobile_320_and_390": True, "page_errors": errors, "passed": True})
        browser.close()
print(json.dumps(checks, indent=2))
