"""Targeted accessibility/recovery checks against isolated staging only.

Uses a local pinned axe-core package; no injected remote script and no model jobs.
The checks are not a complete WCAG or assistive-technology conformance audit.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

SYNTHETIC_ID = '4fb93f5c-1a21-4607-84bc-95a72dfb03d1'
SYNTHETIC_TOKEN = 'A' * 40 + '_-A'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5182/')
    parser.add_argument('--browser', choices=['chromium', 'firefox'], default='chromium')
    parser.add_argument('--axe', default='/srv/crispert/staging/accessibility-audit/node_modules/axe-core/axe.min.js')
    parser.add_argument('--output', default='output/accessibility')
    parser.add_argument('--skip-recovery', action='store_true', help='Audit the UI while recovery integration is pending.')
    args = parser.parse_args()
    if urlparse(args.url).hostname not in {'localhost', '127.0.0.1'}:
        parser.error('Only an isolated localhost frontend is supported.')
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    findings, scans, checks, errors = [], [], [], []
    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        def scan(state):
            page.add_script_tag(path=args.axe)
            result = page.evaluate("""async () => {
              const result = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
              const compact = entry => ({id:entry.id,impact:entry.impact,help:entry.help,helpUrl:entry.helpUrl,nodes:entry.nodes.map(node=>({target:node.target,summary:node.failureSummary}))});
              return {version:axe.version,violations:result.violations.map(compact),incomplete:result.incomplete.map(compact),passes:result.passes.length};
            }""")
            scans.append({'state': state, **result})
            findings.extend({'state': state, **violation} for violation in result['violations'])
            (output / f'{args.browser}-scans.json').write_text(json.dumps({'scans': scans, 'findings': findings}, indent=2) + '\n')

        def no_overflow(state, width):
            page.set_viewport_size({'width': width, 'height': 900})
            page.wait_for_timeout(80)
            dimensions = page.evaluate('({scroll:document.documentElement.scrollWidth, viewport:window.innerWidth})')
            if dimensions['scroll'] > dimensions['viewport'] + 1:
                overflowing = page.locator('body *').evaluate_all("els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width && r.right>innerWidth+1 && getComputedStyle(e).position!=='absolute'}).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,90),right:e.getBoundingClientRect().right}))")
                findings.append({'state': state, 'id': 'horizontal-page-overflow', 'width': width, 'dimensions': dimensions, 'elements': overflowing})
            else:
                checks.append(f'{state}: no page overflow at {width}px')

        def navigate(hash):
            page.goto(args.url.rstrip('/') + '/#' + hash)
            page.wait_for_load_state('networkidle')

        navigate('predict')
        page.keyboard.press('Tab')
        expect(page.get_by_role('link', name='Skip to content')).to_be_focused()
        page.keyboard.press('Enter')
        page.keyboard.press('Tab')
        assert page.evaluate("document.querySelector('main').contains(document.activeElement)"), 'Skip link did not move keyboard navigation into main'
        checks.append('Skip link moves keyboard navigation into main')
        await_focus = page.evaluate("getComputedStyle(document.activeElement).outlineStyle !== 'none'")
        assert await_focus, 'Focused form control has no visible outline'
        checks.append('Keyboard focus outline visible')
        scan('predict')
        for width in [390, 320]: no_overflow('predict', width)
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.get_by_role('button', name='Genome search Find sites for my guides').click()
        scan('genome-form')
        for width in [390, 320]: no_overflow('genome-form', width)

        for target in ['examples', 'evidence', 'help', 'about']:
            page.set_viewport_size({'width': 1280, 'height': 900})
            navigate(target)
            scan(target)
            for width in [390, 320]: no_overflow(target, width)

        page.set_viewport_size({'width': 1280, 'height': 900})
        navigate('examples')
        card = page.locator('.example-card').filter(has=page.get_by_role('heading', name='Explore a public reference guide', exact=True))
        card.get_by_role('button').focus()
        page.keyboard.press('Enter')
        expect(page.locator('#example-detail-title')).to_be_focused()
        expect(page.locator('.analysis-count')).to_contain_text('15 of 15')
        checks.append('Keyboard example activation focuses results heading')
        selection = page.get_by_role('checkbox', name='Select candidate candidate-1, row 1', exact=True)
        selection.focus(); page.keyboard.press('Space')
        expect(selection).to_be_checked()
        expect(page.locator('.analysis-count')).to_contain_text('1 selected')
        checks.append('Keyboard candidate selection updates labelled count')
        region = page.get_by_role('region', name='Candidate results, scroll horizontally for all columns')
        region.focus(); expect(region).to_be_focused()
        checks.append('Wide results table is a labelled keyboard-focusable scroll region')
        scan('example-results')
        page.locator('.analysis-workspace details > summary').evaluate_all('els=>els.forEach(e=>e.parentElement.open=true)')
        page.locator('.model-comparison').get_by_role('combobox').first.select_option(index=1)
        expect(page.get_by_role('img', name='Rank comparison for all', exact=False)).to_be_visible()
        scan('example-results-expanded')
        for width in [390, 320]: no_overflow('example-results-expanded', width)
        # 1280 physical pixels at 200% correspond to a 640 CSS-pixel viewport.
        # This tests reflow at that scale; it does not exercise browser UI zoom.
        original_page = page
        zoom_context = browser.new_context(viewport={'width': 640, 'height': 450}, device_scale_factor=2)
        page = zoom_context.new_page()
        navigate('examples')
        page.locator('.example-card').filter(has=page.get_by_role('heading', name='Explore a public reference guide', exact=True)).get_by_role('button').click()
        expect(page.locator('.analysis-count')).to_contain_text('15 of 15')
        page.locator('.analysis-workspace details > summary').evaluate_all('els=>els.forEach(e=>e.parentElement.open=true)')
        no_overflow('example-results-200-percent-equivalent-reflow', 640)
        scan('example-results-200-percent-equivalent-reflow')
        page.locator('.analysis-heading').scroll_into_view_if_needed()
        page.screenshot(path=str(output / f'{args.browser}-200-percent.png'))
        zoom_context.close()
        page = original_page
        page.set_viewport_size({'width': 320, 'height': 900})
        page.locator('.analysis-heading').scroll_into_view_if_needed()
        page.screenshot(path=str(output / f'{args.browser}-320px.png'))

        # An unavailable API must not erase typed input or disable the static examples.
        page.set_viewport_size({'width': 1280, 'height': 900})
        context.route('**/api/v1/**', lambda route: route.abort())
        navigate('predict')
        page.get_by_role('button', name='Candidate pairs I have candidate sites').click()
        guide = page.get_by_label('Guide sequence with PAM', exact=True)
        guide.fill('GATGCTCTCCAGAATCACTGCGG')
        page.get_by_label('Candidate off-target sites', exact=True).fill('GTTGCTCTTCAGAATCACTGAGG')
        page.get_by_role('button', name='Score candidates', exact=True).click()
        expect(page.get_by_text('The prediction server could not be reached. Your input is still here. Check your connection and retry.', exact=True)).to_be_visible()
        expect(guide).to_have_value('GATGCTCTCCAGAATCACTGCGG')
        checks.append('Unreachable API keeps typed input and reports retryable error')
        page.get_by_role('link', name='Examples', exact=True).click()
        expect(page.get_by_role('heading', name='Explore before you run')).to_be_visible()
        checks.append('Static examples remain available with API blocked')
        context.unroute('**/api/v1/**')

        if not args.skip_recovery:
            # These capabilities are deliberately synthetic. Only job reads are mocked;
            # no real job, raw private input or production endpoint is involved.
            mode = {'value': 'missing'}
            fixture = json.loads((Path(__file__).resolve().parents[2] / 'frontend/public/demonstrations/reference-walkthrough.json').read_text())
            mock_headers = {'Access-Control-Allow-Origin': urlparse(args.url).scheme + '://' + urlparse(args.url).netloc, 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET'}
            def mock_job(route):
                if route.request.method == 'OPTIONS':
                    route.fulfill(status=204, headers=mock_headers); return
                assert route.request.method == 'GET', 'Recovery must not submit or delete a job'
                if mode['value'] == 'missing':
                    route.fulfill(status=404, headers=mock_headers, content_type='application/json', body=json.dumps({'detail': 'This job expired, was deleted, or its private link is invalid.'}))
                elif '/download' in route.request.url:
                    route.fulfill(status=200, headers=mock_headers, content_type='application/json', body=json.dumps(fixture))
                else:
                    route.fulfill(status=200, headers=mock_headers, content_type='application/json', body=json.dumps({'id': SYNTHETIC_ID,'status':'complete','mode':'genome','models':[1,2,3],'created_at':'2026-09-19T10:00:00Z','expires_at':'2030-01-01T12:00:00Z','result_count':15}))
            context.route(f'**/api/v1/jobs/{SYNTHETIC_ID}**', mock_job)
            recovery = args.url.rstrip('/') + f'/?discard=this#job={SYNTHETIC_ID}&token={SYNTHETIC_TOKEN}'
            page.goto(recovery); page.wait_for_load_state('networkidle')
            expect(page.get_by_role('button', name='Forget saved access in this tab', exact=True)).to_be_visible()
            page.get_by_role('button', name='Forget saved access in this tab', exact=True).click()
            assert page.evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('offtargetpred-job:')).length") == 0
            page.reload(); page.wait_for_load_state('networkidle')
            expect(page.get_by_role('button', name='Forget saved access in this tab', exact=True)).to_have_count(0)
            checks.append('Expired private job can be forgotten locally and stays forgotten after refresh')
            mode['value'] = 'complete'
            # Exercise recovery without reloading the app document first.
            page.evaluate("fragment => { window.location.hash = fragment; }", f'job={SYNTHETIC_ID}&token={SYNTHETIC_TOKEN}')
            expect(page.get_by_role('heading', name='Return to this analysis')).to_be_visible()
            assert page.evaluate('window.location.hash') == '#predict'
            checks.append('Private link opened in the same app document restores access and scrubs the fragment')
            page.add_init_script("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError')}}})")
            page.goto('about:blank')
            page.goto(recovery); page.wait_for_load_state('networkidle')
            expect(page.get_by_role('heading', name='Return to this analysis')).to_be_visible()
            field = page.get_by_label('Private result link', exact=True)
            value = field.input_value(); parsed = urlparse(value)
            assert parsed.query == '' and parsed.path == urlparse(args.url).path
            assert parsed.fragment == f'job={SYNTHETIC_ID}&token={SYNTHETIC_TOKEN}'
            page.get_by_role('button', name='Copy private result link', exact=True).click()
            expect(page.get_by_text('Automatic copy is unavailable.', exact=False)).to_be_visible()
            expect(field).to_be_focused()
            assert field.evaluate('(el)=>el.selectionEnd-el.selectionStart===el.value.length')
            expect(page.get_by_text('This link restores server results.', exact=True)).to_be_visible()
            checks.append('Clipboard denial selects a complete manual-copy link without query leakage')
            scan('private-job-recovery')
            page.reload(); page.wait_for_load_state('networkidle')
            expect(page.get_by_role('heading', name='Your analysis', exact=True)).to_be_visible()
            checks.append('Validated session capability restores results after refresh')
            for width in [390, 320]: no_overflow('private-job-recovery', width)
        report = {'browser': args.browser, 'browser_version': browser.version, 'checks': checks, 'scans': scans, 'findings': findings, 'javascript_errors': errors, 'limitations': ['No real assistive-technology or disabled-user study completed.', '200% equivalent reflow uses 640 CSS pixels at 2x device scale on a 1280 physical-pixel viewport; native browser zoom and platform screen magnifiers remain manual checks.', 'Offline API and expired jobs are controlled failure scenarios; no production job is submitted.']}
        (output / f'{args.browser}.json').write_text(json.dumps(report, indent=2) + '\n')
        browser.close()
        print(json.dumps({'browser':args.browser,'checks':len(checks),'scans':len(scans),'findings':findings,'javascript_errors':errors}, indent=2))
        assert not errors, errors
        assert not findings, f'{len(findings)} accessibility findings; see report'


if __name__ == '__main__':
    main()
