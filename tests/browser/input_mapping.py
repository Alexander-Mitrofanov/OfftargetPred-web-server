import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

GUIDE = 'GATGCTCTCCAGAATCACTGCGG'
CANDIDATE = 'GTTGCTCTTCAGAATCACTGAGG'
parser = argparse.ArgumentParser(description="Check local input mapping without submitting prediction jobs.")
parser.add_argument("--url", default="http://127.0.0.1:5182/OfftargetPred-web-server/")
parser.add_argument("--artifacts", type=Path, default=Path("/tmp/offtargetpred-input-mapping"))
args = parser.parse_args()
args.artifacts.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    for engine in ['chromium', 'firefox']:
        browser = getattr(p, engine).launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.set_default_timeout(10000)
        posts = []
        errors = []
        page.on('request', lambda request: posts.append(request.url) if request.method == 'POST' else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.wait_for_load_state('networkidle')
        (args.artifacts / f'column-mapping-{engine}-before.html').write_text(page.content())
        page.get_by_label('Guide sequence', exact=False).fill(GUIDE[:20])
        expect(page.locator('.input-guide')).to_contain_text('20 / 23 characters')
        expect(page.locator('.input-guide')).to_contain_text('Do not append a guessed PAM')
        page.get_by_role('radio', name='CSV / TSV table').check()
        source = page.get_by_label('Sequence pair table', exact=True)
        raw = f'sample,first,second,start,end,strand,assembly,coordinate_system\nexample,{GUIDE},{CANDIDATE},00123,146,-,GRCh38,0-based half-open'
        source.fill(raw)
        page.get_by_text('Map columns from your CSV or TSV', exact=True).click()
        mapper = page.locator('.column-mapper')
        mapper.get_by_label('Guide + PAM').select_option('1')
        mapper.get_by_label('Candidate + PAM').select_option('2')
        mapper.get_by_label('Row identifier').select_option('0')
        expect(mapper.get_by_role('button', name='Apply column mapping')).to_be_disabled()
        expect(mapper).to_contain_text('1 data row · 0 errors')
        expect(mapper).to_contain_text('Metadata retained unchanged')
        mapper.get_by_role('checkbox').check()
        mapper.get_by_role('button', name='Apply column mapping').click()
        expect(source).to_have_value(f'ID,target,off_target,start,end,strand,assembly,coordinate_system\nexample,{GUIDE},{CANDIDATE},00123,146,-,GRCh38,0-based half-open')
        expect(mapper.get_by_role('checkbox')).not_to_be_checked()
        raw_bad = 'ID,target,off_target\n' + '\n'.join(f'row-{i},{GUIDE},{CANDIDATE if i < 12 else CANDIDATE[:20]}' for i in range(1, 13))
        source.fill(raw_bad)
        expect(mapper).to_contain_text('12 data rows · 1 error across 1 invalid rows')
        expect(mapper).to_contain_text('Data row 12, candidate has 20 bases')
        expect(mapper.get_by_role('button', name='Apply column mapping')).to_be_disabled()
        expect(mapper.locator('tbody tr')).to_have_count(10)
        source.fill(f'ID,target,off_target\nexample,{GUIDE},{CANDIDATE}')
        mapper.get_by_role('checkbox').focus()
        page.keyboard.press('Space')
        expect(mapper.get_by_role('checkbox')).to_be_checked()
        page.keyboard.press('Tab')
        expect(mapper.get_by_role('button', name='Apply column mapping')).to_be_focused()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(args.artifacts / f'column-mapping-{engine}-mobile.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Page overflows at 390px'
        source.fill(f'target, target\n{GUIDE},{CANDIDATE}')
        expect(mapper).to_contain_text('Column names must be unique')
        assert not posts, posts
        assert not errors, errors
        results.append({'browser': engine, 'checks': ['20-nt guidance', 'arbitrary column mapping', 'explicit confirmation', 'metadata preservation', 'all-row validation beyond preview', 'keyboard controls', '390px layout', 'duplicate headers', 'no POST requests', 'no page errors'], 'passed': True})
        browser.close()
print(json.dumps(results, indent=2))
