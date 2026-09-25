import os, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / 'dist' / 'itinera.test.html').as_uri()
OUT = ROOT / 'tests' / 'out'
OUT.mkdir(exist_ok=True)
# Software WebGL so MapLibre and three.js run headless. Set CHROME to use a specific browser binary.
ARGS = ['--allow-file-access-from-files', '--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        # fail Google Fonts at once: on some networks the request hangs and blocks page load
        '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND']
def launch(p):
    exe = os.environ.get('CHROME')
    return p.chromium.launch(executable_path=exe, args=ARGS) if exe else p.chromium.launch(args=ARGS)
def attach_logs(pg, logs):
    # Google Fonts fails offline or behind a firewall; that is harmless (system font fallback), so skip it.
    fonts = lambda url: 'fonts.googleapis.com' in url or 'fonts.gstatic.com' in url
    pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') and not fonts(m.location.get('url', '')) else None)
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
async def load_sample(pg):
    await pg.goto(PAGE)
    await pg.wait_for_timeout(1000)
    await pg.click('#sampleBtn')
    await pg.wait_for_function('document.querySelector("#busy").hidden && !document.querySelector("#app").hidden && mapReady', timeout=180000)
    await pg.evaluate("new Promise(r => { map.once('idle', r); map.triggerRepaint(); })")
    await pg.wait_for_timeout(1000)
