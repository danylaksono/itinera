"""Assemble src/ into one self-contained HTML file.

  python3 build.py prod  -> dist/itinera.html       (libraries from CDNs; this is the file to publish)
  python3 build.py test  -> dist/itinera.test.html  (libraries from ./node_modules; works offline)

Both builds carry a Content-Security-Policy (see csp() below), so the browser itself
enforces that the page sends no data anywhere. Both builds inline the MapLibre CSS, the world-atlas countries (about 0.75 MB) and a gazetteer of
towns over 15,000 people from GeoNames (about 0.5 MB, made by tools/gazetteer.js).
"""
import sys, json, glob, os, subprocess, re, hashlib, base64

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('ITINERA_LIB', os.path.join(ROOT, 'node_modules'))
mode = sys.argv[1] if len(sys.argv) > 1 else 'prod'

# (path inside node_modules, pinned CDN url). Keep versions in step with package.json.
LIBS = [
    ('maplibre-gl/dist/maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js'),
    ('d3/dist/d3.min.js', 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js'),
    ('three/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js'),
    ('three/examples/js/controls/OrbitControls.js', 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js'),
    ('animejs/lib/anime.min.js', 'https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js'),
    ('@turf/turf/turf.min.js', 'https://cdn.jsdelivr.net/npm/@turf/turf@7.1.0/turf.min.js'),
    ('topojson-client/dist/topojson-client.min.js', 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js'),
    ('jszip/dist/jszip.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
]

def csp(html, script_hosts):
    """The only way out of the page is the optional street tiles; everything else is blocked."""
    hashes = ' '.join("'sha256-" + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode() + "'"
                      for s in re.findall(r'<script>(.*?)</script>', html, re.S))
    policy = '; '.join([
        "default-src 'none'",
        f"script-src {script_hosts} {hashes}",
        "worker-src blob:",                                     # MapLibre starts its worker from a blob
        "style-src 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src data: blob: https://*.basemaps.cartocdn.com",
        "connect-src https://*.basemaps.cartocdn.com",          # street tiles, only when that layer is on
        "base-uri 'none'", "form-action 'none'"])
    return html.replace('<!--CSP-->', f'<meta http-equiv="Content-Security-Policy" content="{policy}">')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

tpl = read(os.path.join(ROOT, 'src/template.html'))
css = read(os.path.join(LIB, 'maplibre-gl/dist/maplibre-gl.css'))
world = json.dumps(json.loads(read(os.path.join(LIB, 'world-atlas/countries-50m.json'))), separators=(',', ':'))
gaz = subprocess.run(['node', os.path.join(ROOT, 'tools/gazetteer.js')], check=True, capture_output=True, text=True, encoding='utf-8').stdout
# a_ .. g_ are concatenated in name order into ONE script (they share top-level scope)
app = '\n'.join(read(f) for f in sorted(glob.glob(os.path.join(ROOT, 'src/[a-z]_*.js'))))

if mode == 'prod':
    scripts = '\n'.join(f'<script src="{u}"></script>' for _, u in LIBS)
    dst = os.path.join(ROOT, 'dist/itinera.html')
else:
    scripts = '\n'.join(f'<script src="../node_modules/{p}"></script>' for p, _ in LIBS)
    dst = os.path.join(ROOT, 'dist/itinera.test.html')

out = (tpl.replace('/*MAPLIBRE_CSS*/', css)
          .replace('<!--SCRIPTS-->', scripts)
          .replace('/*WORLD*/', 'const WORLD_TOPO=' + world + ';')
          .replace('/*GAZ*/', 'const GAZ=' + gaz + ';')
          .replace('/*APP*/', app))
out = csp(out, "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com" if mode == 'prod' else "'self'")
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, 'w', encoding='utf-8') as f:
    f.write(out)
if mode == 'prod':  # static hosts (GitHub Pages, Netlify) serve index.html
    with open(os.path.join(ROOT, 'dist/index.html'), 'w', encoding='utf-8') as f:
        f.write(out)
size = len(out.encode('utf-8'))
print(f'{dst}  {size/1e6:.2f} MB')
