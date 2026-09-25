"""Screenshots of the main states. Run: python3 tests/shots.py [light|dark]  -> tests/out/*.png"""
import asyncio, sys
from playwright.async_api import async_playwright
from common import launch, attach_logs, load_sample, OUT, PAGE

async def main():
    scheme = sys.argv[1] if len(sys.argv) > 1 else 'light'
    async with async_playwright() as p:
        b = await launch(p)
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, color_scheme=scheme)
        logs = []; attach_logs(pg, logs)
        await pg.goto(PAGE)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=str(OUT / f'0_landing_{scheme}.png'))
        await load_sample(pg)
        await pg.screenshot(path=str(OUT / f'1_map_{scheme}.png'))
        await pg.click('#viewSeg button[data-v=split]'); await pg.wait_for_timeout(5000)
        await pg.screenshot(path=str(OUT / f'2_split_{scheme}.png'))
        await pg.click('#colorSeg button[data-v=mode]')
        await pg.evaluate("setTimeRange(Date.UTC(2025,8,8), Date.UTC(2025,8,17), 'x')"); await pg.wait_for_timeout(4000)
        await pg.screenshot(path=str(OUT / f'3_filtered_{scheme}.png'))
        await pg.evaluate("setTimeRange(null,null,'x'); map.jumpTo({center:[-9.14,38.73], zoom:11.5})"); await pg.wait_for_timeout(1500)
        await pg.evaluate("S.play.clock = Date.UTC(2025,5,4,7,0); S.play.session = true; drawFrame(true)")
        await pg.click('#playBtn'); await pg.wait_for_timeout(3000); await pg.click('#playBtn'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path=str(OUT / f'4_playback_{scheme}.png'))
        await pg.click('#viewSeg button[data-v=cube]'); await pg.wait_for_timeout(4000)
        await pg.screenshot(path=str(OUT / f'5_cube_{scheme}.png'))
        for l in logs: print(l)
        await b.close()
asyncio.run(main())
