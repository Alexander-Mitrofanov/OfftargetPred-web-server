"""Browser acceptance against the actual GPU API via local SSH tunnel."""
import json
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5180/')
    page.wait_for_load_state('networkidle')
    page.get_by_text('Prediction server connected',exact=True).wait_for()
    checks.append('Connected to actual GPU API through SSH tunnel')
    page.get_by_role('button',name='Load example',exact=True).click()
    page.get_by_role('checkbox',name=re.compile('k=2')).check()
    page.get_by_role('checkbox',name=re.compile('k=3')).check()
    page.get_by_role('button',name='Score candidates',exact=True).click()
    page.get_by_role('heading',name='Prediction results',exact=True).wait_for(timeout=120000)
    page.get_by_role('button',name='Download CSV',exact=True).wait_for()
    page.wait_for_load_state('networkidle')
    assert page.locator('.results-table tbody tr').count() > 0
    checks.append('Submitted and rendered actual three-model predictions')
    page.screenshot(path=str(OUT/'live-results-desktop.png'),full_page=True)
    with page.expect_download() as download_info:
        page.get_by_role('button',name='JSON & metadata',exact=True).click()
    download=download_info.value
    download.save_as(str(OUT/'live-results.json'))
    document=json.loads((OUT/'live-results.json').read_text())
    assert document['metadata']['device']=='cuda'
    assert set(document['rows'][0]['scores'])=={'k1','k2','k3'}
    checks.append('Downloaded real GPU scores and provenance')
    page.reload(); page.wait_for_load_state('networkidle')
    page.get_by_role('heading',name='Prediction results',exact=True).wait_for(timeout=30000)
    checks.append('Recovered result after browser refresh')
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'live-results-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    checks.append('390px viewport has no document overflow')
    page.on('dialog',lambda dialog:dialog.accept())
    page.get_by_role('button',name='Delete job and data',exact=True).click()
    page.get_by_role('heading',name='Prediction results',exact=True).wait_for(state='hidden')
    checks.append('Deleted private job through browser')
    assert not errors, errors
    checks.append('No browser JavaScript errors')
    browser.close()
report={'passed':True,'checks':checks}
(OUT/'live-browser-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
