"""Load the sample, print the key numbers, fail on page errors. Run: python3 tests/smoke.py"""
import asyncio, json, sys
from playwright.async_api import async_playwright
from common import launch, attach_logs, load_sample

async def main():
    async with async_playwright() as p:
        b = await launch(p)
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        logs = []; attach_logs(pg, logs)
        await load_sample(pg)
        r = json.loads(await pg.evaluate('''JSON.stringify({
          sources: S.sources.map(s => ({name: s.name, records: s.T.length, stays: s.visits.length, trips: s.trips.length, derived: s.derivedVisits})),
          places: S.ctx.places.length, home: S.ctx.places[S.ctx.home]?.label, work: S.ctx.places[S.ctx.work]?.label,
          kpi: S.res.kpi, kpiText: [...document.querySelectorAll('.kpi .n')].map(e => e.textContent),
          together: document.querySelector('#together').textContent })'''))
        # the cube floor must be the map view from before the switch, not the hidden map's fallback canvas
        before = await pg.evaluate('map.getBounds().toArray().flat()')
        await pg.click('#viewSeg button[data-v=cube]'); await pg.wait_for_timeout(1500)
        after = await pg.evaluate('viewBounds().toArray().flat()')
        r['cubeFloorOk'] = all(abs(a - b) < 1e-6 for a, b in zip(before, after))
        await pg.click('#viewSeg button[data-v=map]'); await pg.wait_for_timeout(1000)
        back = await pg.evaluate('map.getBounds().toArray().flat()')
        r['mapViewKept'] = all(abs(a - b) < 1e-3 for a, b in zip(before, back))
        print(json.dumps(r, indent=1))
        errs = [l for l in logs if 'PAGEERROR' in l or ('error' in l and 'fonts.googleapis' not in l and '403' not in l)]
        for l in logs: print(l)
        ok = (not errs and r['home'] == 'Home' and r['work'] == 'Work' and r['kpi']['countries'] == 2
              and len(r['sources']) == 3 and r['cubeFloorOk'] and r['mapViewKept'] and all(t != '0' for t in r['kpiText'][:3]))
        await b.close()
        print('SMOKE', 'PASS' if ok else 'FAIL')
        sys.exit(0 if ok else 1)
asyncio.run(main())
