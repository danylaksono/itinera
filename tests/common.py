import os, pathlib, threading, functools, http.server
ROOT = pathlib.Path(__file__).resolve().parent.parent

# Serve the project over http (not file://) so the page's Content-Security-Policy applies as on a real host.
class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
_srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(_Quiet, directory=str(ROOT)))
threading.Thread(target=_srv.serve_forever, daemon=True).start()
PAGE = f'http://127.0.0.1:{_srv.server_port}/dist/itinera.test.html'
OUT = ROOT / 'tests' / 'out'
OUT.mkdir(exist_ok=True)
# Software WebGL so MapLibre and three.js run headless. Set CHROME to use a specific browser binary.
ARGS = ['--use-gl=angle', '--use-angle=swiftshader',
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
async def wait_for(pg, expr, timeout=180000):
    # page.wait_for_function builds its check with eval, which the page's policy blocks; evaluate is not affected
    for _ in range(timeout // 250):
        if await pg.evaluate(expr): return
        await pg.wait_for_timeout(250)
    raise TimeoutError(expr)
async def load_sample(pg):
    await pg.goto(PAGE)
    await pg.wait_for_timeout(1000)
    await pg.click('#sampleBtn')
    await wait_for(pg, 'document.querySelector("#busy").hidden && !document.querySelector("#app").hidden && mapReady')
    await pg.evaluate("new Promise(r => { map.once('idle', r); map.triggerRepaint(); })")
    await pg.wait_for_timeout(1000)
