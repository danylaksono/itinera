"""Assemble src/ into one self-contained HTML file.

  python3 build.py prod  -> dist/itinera.html       (libraries from CDNs; this is the file to publish)
  python3 build.py test  -> dist/itinera.test.html  (libraries from ./node_modules; works offline)

Both builds inline the MapLibre CSS and the world-atlas countries (about 0.75 MB).
"""
import sys, json, glob, os

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

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

tpl = read(os.path.join(ROOT, 'src/template.html'))
css = read(os.path.join(LIB, 'maplibre-gl/dist/maplibre-gl.css'))
world = json.dumps(json.loads(read(os.path.join(LIB, 'world-atlas/countries-50m.json'))), separators=(',', ':'))
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
          .replace('/*APP*/', app))
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, 'w', encoding='utf-8') as f:
    f.write(out)
size = len(out.encode('utf-8'))
print(f'{dst}  {size/1e6:.2f} MB')
if size > 16e6:
    sys.exit('ERROR: file is over the 16 MB artifact limit')
