/* Screenshots of the main states: node tests/shots.mjs [light|dark] -> tests/out/*.png */
import path from 'path';
import { serve, launch, attachLogs, loadSample, OUT } from './common.mjs';

const scheme = process.argv[2] || 'light';
const site = await serve();
const b = await launch();
// the sample lives in Lisbon: Records.json has no UTC offsets and falls back to the browser time zone (AGENTS.md, section 9)
const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, timezoneId: 'Europe/Lisbon' });
const logs = [];
attachLogs(pg, logs);
const shot = name => pg.screenshot({ path: path.join(OUT, `${name}_${scheme}.png`) });
await pg.goto(site.url);
await pg.waitForTimeout(2500);
await shot('0_landing');
await loadSample(pg, site.url);
await shot('1_map');
await pg.click('#viewSeg button[data-v=split]'); await pg.waitForTimeout(5000);
await shot('2_split');
await pg.click('#colorSeg button[data-v=mode]');
await pg.evaluate("window.__itinera.setTimeRange(Date.UTC(2025, 8, 8), Date.UTC(2025, 8, 17), 'x')"); await pg.waitForTimeout(4000);
await shot('3_filtered');
await pg.evaluate("window.__itinera.setTimeRange(null, null, 'x'); window.__itinera.map.jumpTo({ center: [-9.14, 38.73], zoom: 11.5 })"); await pg.waitForTimeout(1500);
await pg.evaluate('window.__itinera.seek(Date.UTC(2025, 5, 4, 7, 0))');
await pg.click('#playBtn'); await pg.waitForTimeout(3000); await pg.click('#playBtn'); await pg.waitForTimeout(2500);
await shot('4_playback');
await pg.click('#viewSeg button[data-v=cube]'); await pg.waitForTimeout(4000);
await shot('5_cube');
// place timetable: all days stacked, then one week along the calendar
await pg.click('#stopBtn'); await pg.click('#colorSeg button[data-v=device]');
await pg.click('#viewSeg button[data-v=marey]'); await pg.waitForTimeout(2000);
await shot('7_timetable');
await pg.click('#mareySeg button[data-v=calendar]');
await pg.evaluate("window.__itinera.setTimeRange(Date.UTC(2025, 4, 5), Date.UTC(2025, 4, 12), 'x')"); await pg.waitForTimeout(2000);
await shot('8_timetable_week');
await pg.click('#mareySeg button[data-v=days]'); await pg.evaluate("window.__itinera.setTimeRange(null, null, 'x')");
await pg.click('#viewSeg button[data-v=split]'); await pg.waitForTimeout(3000);
await shot('9_split_timetable');
// country scale: the built-in outline map (coastlines and borders)
await pg.click('#viewSeg button[data-v=map]'); await pg.click('#stopBtn');
await pg.evaluate('window.__itinera.map.jumpTo({ center: [-3, 40], zoom: 4.2 })'); await pg.waitForTimeout(3000);
await shot('6_country');
for (const l of logs) console.log(l);
await b.close(); site.close();
