"""Exercise the sensitivity UI using a public-example scored fixture, without new jobs."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:5182/")
parser.add_argument("--document", type=Path, required=True, help="61-row public-example sensitivity result JSON")
parser.add_argument("--artifacts", type=Path, default=Path("/tmp/offtargetpred-sensitivity-browser"))
args = parser.parse_args()
document = json.loads(args.document.read_text())
assert len(document["rows"]) == 61
args.artifacts.mkdir(parents=True, exist_ok=True)
job_id = "11111111-1111-4111-8111-111111111111"
job = {"id": job_id, "status": "completed", "mode": "pairs", "models": [1, 2, 3], "created_at": "2026-09-19T12:00:00Z", "result_count": 61}
results = []
with sync_playwright() as p:
    for engine in ("chromium", "firefox"):
        browser = getattr(p, engine).launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.set_default_timeout(15000)
        posts, errors = [], []
        page.on("request", lambda request: posts.append(request.url) if request.method == "POST" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/api/v1/jobs/**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(document if "/download" in route.request.url else job)))
        page.goto(args.url + f"#job={job_id}&token=" + "A" * 43)
        widget = page.locator(".sequence-sensitivity")
        expect(widget).to_have_count(1)
        widget.locator(":scope > summary").focus()
        page.keyboard.press("Enter")
        expect(widget.get_by_role("heading", name="Complete 61-pair panel")).to_be_visible()
        expect(widget.locator("tbody tr")).to_have_count(20)
        for model in ("k1", "k2", "k3"):
            widget.get_by_label("Model", exact=True).select_option(model)
            expect(widget.locator("caption")).to_contain_text(f"CRISPert {model}")
            expect(widget.locator("td details")).to_have_count(80)
        first_cell = widget.locator("td details").first
        first_cell.locator("summary").focus()
        page.keyboard.press("Enter")
        expect(first_cell).to_contain_text("Original:")
        assert first_cell.get_attribute("open") is not None
        for width in (390, 320):
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Page overflows at {width}px"
            widget.screenshot(path=str(args.artifacts / f"sensitivity-{engine}-{width}.png"))
        page.locator(".analysis-table tbody input[type=checkbox]").first.check()
        expect(widget.get_by_role("button", name="Prepare 61-pair sensitivity input")).to_be_enabled()
        widget.get_by_role("button", name="Prepare 61-pair sensitivity input").click()
        expect(page.get_by_role("heading", name="New prediction", exact=True)).to_be_focused()
        value = page.get_by_label("Sequence pair table", exact=True).input_value()
        assert len(value.splitlines()) == 62
        assert "sensitivity_schema" in value
        assert not posts, posts
        assert not errors, errors
        # Independently check prepare-from-example through the ordinary navigation path.
        demo = browser.new_page(viewport={"width": 1280, "height": 900})
        demo.on("request", lambda request: posts.append(request.url) if request.method == "POST" else None)
        demo.on("pageerror", lambda error: errors.append(str(error)))
        demo.goto(args.url + "#examples")
        demo.get_by_role("button", name="Explore results").first.click()
        demo.locator(".analysis-table tbody input[type=checkbox]").first.check()
        demo.locator(".sequence-sensitivity > summary").click()
        demo.get_by_role("button", name="Prepare 61-pair sensitivity input").click()
        expect(demo.get_by_role("heading", name="New prediction", exact=True)).to_be_focused()
        assert len(demo.get_by_label("Sequence pair table", exact=True).input_value().splitlines()) == 62
        assert not posts, posts
        assert not errors, errors
        results.append({"browser": engine, "passed": True, "checks": ["full 61-row reconstruction", "three separate model grids", "keyboard disclosure and cell values", "390px and 320px layout", "new panel from results and example", "61-row form prefill", "focus handoff", "no POST requests", "no page errors"]})
        browser.close()
print(json.dumps(results, indent=2))
