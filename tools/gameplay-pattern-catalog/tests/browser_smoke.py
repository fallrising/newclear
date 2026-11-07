"""Optional real-browser QA. Requires Playwright and Chromium; not a runtime dependency."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render-only', action='store_true', help='Render actual built bytes without URL navigation; does not certify browser navigation')
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('NOT RUN: install Playwright and a Chromium browser for browser QA', file=sys.stderr)
        return 77
    with tempfile.TemporaryDirectory() as tmp:
        parent = Path(tmp)
        output = parent / 'nested' / 'catalog'
        build.build(output)
        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(parent)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as runner:
                executable = os.environ.get('BROWSER_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
                options = {'headless': True}
                if executable:
                    options['executable_path'] = executable
                browser = runner.chromium.launch(**options)
                errors, network = [], []
                context = browser.new_context(viewport={'width': 1440, 'height': 1000})
                page = context.new_page()
                page.set_default_timeout(5000)
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: network.append(request.url))
                base = f'http://127.0.0.1:{server.server_port}/nested/catalog/'
                def load(page, relative):
                    if not args.render_only:
                        page.goto(base + relative)
                        return
                    text = (output / relative).read_text()
                    import re
                    text = re.sub(r'<link rel="stylesheet"[^>]+>', '', text)
                    text = re.sub(r'<script src="app.js" defer></script>', '', text)
                    text = text.replace('</head>', '<style>' + (output / 'style.css').read_text() + '</style></head>')
                    if relative == 'index.html':
                        text = text.replace('</body>', '<script>' + (output / 'app.js').read_text() + '</script></body>')
                    page.set_content(text, wait_until='domcontentloaded')
                load(page, 'index.html')
                catalog = __import__('json').loads((output / 'catalog.json').read_text())
                total = len(catalog['patterns'])
                inventory = sum(item['category'] == 'inventory' for item in catalog['patterns'])
                assert page.locator('.card:visible').count() == total
                page.locator('#category').select_option('inventory')
                assert page.locator('.card:visible').count() == inventory
                page.locator('#search').fill('shape')
                assert page.locator('.card:visible').count() == 1
                page.locator('#search').fill('沒有這個模式xyz')
                assert page.locator('.card:visible').count() == 0
                assert page.locator('#empty').is_visible()
                page.locator('button[type=reset]').click()
                assert page.locator('.card:visible').count() == total
                page.locator('#status').select_option('pending')
                assert page.locator('.card:visible').count() == 0
                assert page.locator('#empty').is_visible()
                page.locator('button[type=reset]').click()
                page.get_by_role('link', name='完整度', exact=True).click()
                assert page.locator('h1').inner_text() == '完整度報表'
                if args.render_only:
                    load(page, 'index.html')
                else:
                    page.get_by_role('link', name='GAMEPLAY / PATTERNS', exact=True).click()
                page.locator('#search').fill('stamina')
                ascii_count = page.locator('.card:visible').count()
                page.locator('#search').fill('ＳＴＡＭＩＮＡ')
                assert ascii_count >= 1
                assert page.locator('.card:visible').count() == ascii_count
                page.locator('button[type=reset]').click()
                print('PASS: search, category, empty state, reset and NFKC', flush=True)
                screenshots = os.environ.get('SCREENSHOT_DIR')
                if screenshots:
                    Path(screenshots).mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(Path(screenshots) / 'gameplay-catalog-desktop.png'), full_page=True)
                if args.render_only:
                    assert page.get_by_role('link', name='形狀式背包配置', exact=True).get_attribute('href') == 'patterns/inventory-shape-packing.html'
                    load(page, 'patterns/inventory-shape-packing.html')
                else:
                    page.get_by_role('link', name='形狀式背包配置', exact=True).click()
                assert page.locator('#references').count() == 1
                assert page.get_by_role('link', name='Shape-based packing — Gameplay Atlas', exact=True).get_attribute('href') == 'https://gameplayatlas.loopyhop.com/mechanic/inventory-shape-packing/'
                if args.render_only:
                    load(page, 'patterns/inventory-adjacency.html')
                else:
                    page.get_by_role('link', name='相鄰關係驅動的組合加成', exact=True).click()
                assert page.locator('h1').inner_text() == '相鄰關係驅動的組合加成'
                if args.render_only:
                    load(page, 'metadata.html')
                else:
                    page.get_by_role('link', name='Metadata 指引', exact=True).click()
                assert page.locator('h1').inner_text() == 'Metadata 指引'
                print('PASS: detail, sources, related content and metadata', flush=True)
                mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                mobile_page = mobile.new_page()
                load(mobile_page, 'index.html')
                assert mobile_page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                if screenshots:
                    mobile_page.screenshot(path=str(Path(screenshots) / 'gameplay-catalog-mobile.png'), full_page=True)
                print('PASS: mobile width', flush=True)
                no_js = browser.new_context(java_script_enabled=False)
                no_js_page = no_js.new_page()
                load(no_js_page, 'index.html')
                assert no_js_page.locator('.card').count() == total
                if args.render_only:
                    load(no_js_page, 'patterns/inventory-shape-packing.html')
                else:
                    no_js_page.get_by_role('link', name='形狀式背包配置', exact=True).click()
                assert no_js_page.locator('#references').count() == 1
                assert not errors, errors
                assert all(url.startswith(f'http://127.0.0.1:{server.server_port}/') for url in network), network
                browser.close()
                mode = 'render-only DOM; browser URL navigation NOT TESTED' if args.render_only else 'full browser HTTP navigation'
                print('PASS: ' + mode + '; search/category/reset/NFKC, source and detail content, 390px mobile, no-JS content, no page errors or external requests')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
