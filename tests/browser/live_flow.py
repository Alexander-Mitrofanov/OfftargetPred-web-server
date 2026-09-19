"""Browser acceptance against the actual GPU API, privately or on GitHub Pages.

Set OFFTARGETPRED_UI_URL to the deployed frontend URL for public acceptance.
Set OFFTARGETPRED_TEST_GENOME=1 to also search the installed GRCh38 reference.
"""
import json
import ipaddress
import os
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/playwright'
OUT.mkdir(parents=True, exist_ok=True)
UI_URL = os.environ.get('OFFTARGETPRED_UI_URL', 'http://127.0.0.1:5180/')
BROWSER = os.environ.get('OFFTARGETPRED_TEST_BROWSER', 'chromium')
if BROWSER not in {'chromium', 'firefox'}:
    raise ValueError('Choose chromium or firefox for OFFTARGETPRED_TEST_BROWSER')
RELAY_IP = os.environ.get('OFFTARGETPRED_TEST_RELAY_IP')
launch_args = ['--no-sandbox']
if RELAY_IP:
    if BROWSER != 'chromium':
        raise ValueError('The diagnostic relay override is supported only by Chromium')
    # Diagnostic only: preserve HTTPS/SNI/certificate validation. Reports must
    # distinguish this from normal public DNS/browser acceptance.
    relay = str(ipaddress.IPv4Address(RELAY_IP))
    launch_args.append('--host-resolver-rules=MAP offtargetpred-web.tail58d78e.ts.net ' + relay)
checks=[]
with sync_playwright() as p:
    launch_options = {'headless': True}
    if BROWSER == 'chromium':
        launch_options['args'] = launch_args
    if os.environ.get('OFFTARGET_BROWSER_EXECUTABLE'):
        launch_options['executable_path'] = os.environ['OFFTARGET_BROWSER_EXECUTABLE']
    browser=getattr(p, BROWSER).launch(**launch_options)
    browser_version = browser.version
    context=browser.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto(UI_URL)
    page.wait_for_load_state('networkidle')
    page.get_by_text('Prediction server connected',exact=True).wait_for()
    checks.append('Connected to actual GPU API from configured frontend')
    page.get_by_role('button',name='Load example',exact=True).click()
    page.locator('.advanced-models > summary').click()
    page.get_by_role('checkbox',name=re.compile('k=2')).check()
    page.get_by_role('checkbox',name=re.compile('k=3')).check()
    page.get_by_role('button',name='Score candidates',exact=True).click()
    page.get_by_role('heading',name='Your analysis',exact=True).wait_for(timeout=120000)
    page.get_by_role('button',name='Download full CSV',exact=True).wait_for()
    page.wait_for_load_state('networkidle')
    assert page.locator('.analysis-table tbody tr').count() > 0
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
    page.get_by_role('heading',name='Your analysis',exact=True).wait_for(timeout=30000)
    checks.append('Recovered result after browser refresh')
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'live-results-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    checks.append('390px viewport has no document overflow')
    page.on('dialog',lambda dialog:dialog.accept())
    page.get_by_role('button',name='Delete job and data',exact=True).click()
    page.get_by_role('heading',name='Your analysis',exact=True).wait_for(state='hidden')
    checks.append('Deleted private job through browser')
    if os.environ.get('OFFTARGETPRED_TEST_GENOME') == '1':
        # Read independently from the pinned Ensembl115 primary assembly at
        # chromosome 1, start0=100056, plus strand during operator acceptance.
        guide = 'TGAGACTCTTGCAGTCACACAGG'
        page.set_viewport_size({'width':1440,'height':1000})
        page.get_by_role('button',name='Genome search',exact=False).click()
        page.get_by_label('Guide sequences',exact=False).fill(guide)
        page.get_by_role('combobox',name=re.compile('Maximum mismatches')).select_option('1')
        if not page.locator('.advanced-models').evaluate('(element) => element.open'):
            page.locator('.advanced-models > summary').click()
        for k in (1, 2, 3):
            page.get_by_role('checkbox',name=re.compile(f'k={k}')).check()
        page.get_by_role('button',name='Find and score candidates',exact=True).click()
        page.get_by_role('heading',name='Your analysis',exact=True).wait_for(timeout=180000)
        page.get_by_role('button',name='JSON & metadata',exact=True).wait_for()
        with page.expect_download() as genome_download:
            page.get_by_role('button',name='JSON & metadata',exact=True).click()
        genome_path = OUT / 'live-genome-results.json'
        genome_download.value.save_as(str(genome_path))
        genome = json.loads(genome_path.read_text())
        assert genome['metadata']['device'] == 'cuda'
        assert genome['metadata']['reference']['assembly'] == 'GRCh38'
        assert len(genome['rows']) == 15
        assert all(set(row['scores']) == {'k1','k2','k3'} for row in genome['rows'])
        assert any(row['chromosome'] == '1' and row['start'] == 100056
                   and row['strand'] == '+' and row['off_target'] == guide
                   for row in genome['rows'])
        checks.append('Real GRCh38 browser search: 15 sites, expected locus and three GPU models')
        page.screenshot(path=str(OUT/'live-genome-results.png'),full_page=True)
        page.get_by_role('button',name='Delete job and data',exact=True).click()
        page.get_by_role('heading',name='Your analysis',exact=True).wait_for(state='hidden')
        checks.append('Deleted genome-search job through browser')
    assert not errors, errors
    checks.append('No browser JavaScript errors')
    browser.close()
report={'passed':True,'browser':BROWSER,'browser_version':browser_version,'frontend_url':UI_URL,'dns_mode':'explicit relay override' if RELAY_IP else 'normal resolver','checks':checks}
(OUT/'live-browser-report.json').write_text(json.dumps(report,indent=2)+'\n')
(OUT/f'live-browser-report-{BROWSER}.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
