"""Browser behavior and visual smoke checks against deterministic API fixtures.

These fixtures test the UI contract, not model accuracy or live deployment.
Run the live integration tests separately against the real API.

OFFTARGETPRED_UI_URL=http://127.0.0.1:5173/OfftargetPred-web-server/ \
  python tests/browser_smoke.py
Requires Python Playwright and Chrome; CHROME_PATH may override the executable.
Screenshots are written to /tmp by default (UI_ARTIFACT_DIR overrides it).
"""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

URL = os.getenv('OFFTARGETPRED_UI_URL', 'http://127.0.0.1:5173/OfftargetPred-web-server/')
ARTIFACTS = Path(os.getenv('UI_ARTIFACT_DIR', '/tmp/offtargetpred-ui'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
GUIDE = 'GATGCTCTCCAGAATCACTGCGG'
CAPABILITIES = {
    'modes': ['pairs', 'genome'],
    'models': [{'id': k, 'key': f'k{k}', 'label': f'{k}-mer', 'default': k == 1} for k in (1, 2, 3)],
    'default_models': [1], 'limits': {'request_bytes': 5242880, 'pairs': 10000, 'guides': 10, 'candidates': 50000, 'queued': 10},
    'retention_hours': 24, 'genomes': [{'id': 'GRCh38', 'label': 'Human GRCh38 primary assembly'}],
    'score_label': 'CRISPert score', 'calibrated': False, 'worker': {'available': True},
}
ROWS = [
    {'id': 'site-1', 'target': GUIDE, 'off_target': 'GTTGCTCTTCAGAATCACTGAGG', 'mismatches': 2, 'scores': {'k1': .7524, 'k2': .6178, 'k3': .7219}},
    {'id': 'site-2', 'target': GUIDE, 'off_target': 'GCTGCCCTCCAGGATCACTGGGG', 'mismatches': 3, 'scores': {'k1': .2934, 'k2': .3418, 'k3': .2591}},
    {'id': 'site-3', 'target': GUIDE, 'off_target': GUIDE, 'mismatches': 0, 'scores': {'k1': .9013, 'k2': .8824, 'k3': .8516}},
]
submitted = []
requests = []
errors = []


def mock(route):
    request = route.request
    parsed = urlparse(request.url)
    path = parsed.path
    query = parse_qs(parsed.query)
    requests.append((request.method, path, request.headers))
    if path.endswith('/capabilities'):
        return route.fulfill(json=CAPABILITIES)
    if path.endswith('/jobs') and request.method == 'POST':
        payload = request.post_data_json
        submitted.append(payload)
        return route.fulfill(status=202, json={'id': 'fixture-job', 'token': 'fixture-private-token', 'status': 'queued'})
    if '/jobs/' in path:
        assert request.headers.get('authorization') == 'Bearer fixture-private-token'
    if path.endswith('/download'):
        if query.get('format') == ['json']:
            return route.fulfill(content_type='application/json', body=json.dumps({'rows': ROWS, 'metadata': {'fixture': True}}))
        return route.fulfill(content_type='text/csv', body='id,target,off_target,score_k1\nsite-1,' + GUIDE + ',' + ROWS[0]['off_target'] + ',0.7524\n')
    if path.endswith('/results'):
        rows = ROWS
        if query.get('q'):
            rows = [row for row in rows if query['q'][0].lower() in row['id'].lower()]
        return route.fulfill(json={'total': len(rows), 'offset': 0, 'limit': 25, 'rows': rows, 'metadata': {'fixture': True}})
    if request.method == 'DELETE':
        return route.fulfill(status=202, json={'status': 'deleted'})
    payload = submitted[-1] if submitted else {'mode': 'pairs', 'models': [1, 2, 3], 'name': 'Recovered job'}
    return route.fulfill(json={'id': 'fixture-job', 'status': 'completed', 'mode': payload['mode'], 'models': payload['models'], 'name': payload['name'], 'created_at': '2026-09-19T12:00:00Z', 'expires_at': '2026-09-20T12:00:00Z', 'result_count': 3})


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.getenv('CHROME_PATH', '/usr/bin/google-chrome'), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, permissions=['clipboard-read', 'clipboard-write'])
    context.route('**/api/v1/**', mock)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('status')).to_contain_text('Prediction server connected')
    page.screenshot(path=str(ARTIFACTS / 'desktop-input.png'), full_page=True)

    # Empty input reports actionable errors and never sends data.
    page.get_by_role('button', name='Score candidates', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('exactly 23')
    assert not submitted
    page.get_by_role('button', name='Load example', exact=True).click()
    page.get_by_role('checkbox', name='k=2', exact=False).check()
    page.get_by_role('checkbox', name='k=3', exact=False).check()
    page.get_by_label('Job name').fill('Fixture comparison')
    page.get_by_role('button', name='Score candidates', exact=True).click()
    expect(page.get_by_role('heading', name='Prediction results')).to_be_visible()
    expect(page.get_by_role('cell', name='0.7524', exact=True)).to_be_visible()
    assert submitted[-1]['models'] == [1, 2, 3]
    assert submitted[-1]['format'] == 'csv'
    assert submitted[-1]['input'].count('\n') == 3
    assert 'fixture-private-token' not in page.url
    page.screenshot(path=str(ARTIFACTS / 'desktop-results.png'), full_page=True)

    # Global server filtering, download formats and access-control headers.
    page.get_by_label('Filter candidates').fill('site-2')
    expect(page.get_by_text('1–1 of 1 matching candidates')).to_be_visible()
    page.get_by_label('Filter candidates').fill('')
    expect(page.get_by_text('1–3 of 3 candidates')).to_be_visible()
    with page.expect_download() as download:
        page.get_by_role('button', name='Download CSV').click()
    assert download.value.suggested_filename.endswith('.csv')
    with page.expect_download() as download:
        page.get_by_role('button', name='JSON & metadata').click()
    assert download.value.suggested_filename.endswith('.json')
    page.get_by_role('button', name='Copy private result link').click()
    expect(page.get_by_role('button', name='Private link copied')).to_be_visible()
    link = page.evaluate('navigator.clipboard.readText()')
    assert '#job=fixture-job&token=fixture-private-token' in link

    # Recovery from the fragment strips the capability from the address bar.
    recovered = context.new_page()
    recovered.goto(link)
    recovered.wait_for_load_state('networkidle')
    expect(recovered.get_by_role('heading', name='Prediction results')).to_be_visible()
    assert 'token=' not in recovered.url
    recovered.close()

    # Mobile input, documentation, file upload, malformed tables and N warnings.
    mobile = browser.new_context(viewport={'width': 360, 'height': 820})
    mobile.route('**/api/v1/**', mock)
    small = mobile.new_page()
    small.goto(URL)
    small.wait_for_load_state('networkidle')
    small.get_by_role('button', name='Load example', exact=True).click()
    small.screenshot(path=str(ARTIFACTS / 'mobile-input.png'), full_page=True)
    assert small.evaluate('document.body.scrollWidth <= innerWidth')
    small.get_by_label('Candidate off-target sites').fill('N' + GUIDE[1:])
    expect(small.get_by_text('Some sequences contain N.', exact=False)).to_be_visible()
    small.get_by_role('radio', name='CSV / TSV table').check()
    small.get_by_label('Upload CSV or TSV').set_input_files({'name': 'pairs.tsv', 'mimeType': 'text/tab-separated-values', 'buffer': f'ID\ttarget\toff_target\ncustom\t{GUIDE}\t{GUIDE}'.encode()})
    expect(small.get_by_label('Sequence pair table')).to_have_value(f'ID\ttarget\toff_target\ncustom\t{GUIDE}\t{GUIDE}')
    expect(small.get_by_text('1 pair ready across 1 guide')).to_be_visible()
    small.get_by_role('button', name='Genome search', exact=False).click()
    small.get_by_role('button', name='Load example', exact=True).click()
    small.screenshot(path=str(ARTIFACTS / 'mobile-genome.png'), full_page=True)
    assert small.evaluate('document.body.scrollWidth <= innerWidth')
    small.get_by_role('button', name='Find and score candidates').click()
    expect(small.get_by_role('heading', name='Prediction results')).to_be_visible()
    assert submitted[-1]['mode'] == 'genome'
    assert submitted[-1]['assembly'] == 'GRCh38'
    assert submitted[-1]['format'] == 'fasta'
    assert submitted[-1]['max_mismatches'] == 3
    small.get_by_role('link', name='Help', exact=True).click()
    expect(small.get_by_role('heading', name='From sequences to scores')).to_be_visible()
    assert small.evaluate('document.body.scrollWidth <= innerWidth')
    small.screenshot(path=str(ARTIFACTS / 'mobile-help.png'), full_page=True)
    mobile.close()

    # Unavailable API must preserve preparation without fake scoring.
    offline = browser.new_context(viewport={'width': 1200, 'height': 900})
    offline.route('**/api/v1/**', lambda route: route.abort())
    offline_page = offline.new_page()
    offline_page.goto(URL)
    offline_page.wait_for_load_state('networkidle')
    expect(offline_page.get_by_role('status')).to_contain_text('Prediction server unavailable')
    offline_page.get_by_role('button', name='Load example').click()
    expect(offline_page.get_by_role('button', name='Score candidates', exact=True)).to_be_disabled()
    offline.close()
    assert not errors, errors
    assert all('token=' not in path for _, path, _ in requests)
    print('PASS: validation, pair submission, all-model results, filter, CSV/JSON downloads, capability recovery, mobile layouts, upload, N warning, genome submission, help, unavailable API.')
    print('Screenshots:', ARTIFACTS)
    browser.close()
