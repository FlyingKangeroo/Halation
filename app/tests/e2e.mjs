// End-to-end smoke test: boot the built app in headless Chromium with a
// software GPU, load a fixture, screenshot the UI, export, and check that
// the rendered TIFF shows halation around the bright spots.
//
// Usage: npm run build && node tests/e2e.mjs

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.tif': 'image/tiff' };
const server = createServer((req, res) => {
  const path = join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(path)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', acceptDownloads: true });
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector('.empty');
await page.screenshot({ path: join(out, '01-empty.png') });

// Load the 16-bit fixture through the same path a dropped file takes.
const fixture = readFileSync(join(here, 'fixtures', 'lamp16-zip.tif'));
await page.evaluate(async (bytes) => {
  await window.halation.openBytes('lamp16-zip.tif', new Uint8Array(bytes));
}, Array.from(fixture));
await page.waitForSelector('.inspector:not(.is-hidden)');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, '02-loaded.png') });

// Turn on bloom and damage so every code path renders at least once.
const switches = page.locator('.section .switch input');
await switches.nth(2).check(); // bloom
await switches.nth(3).check(); // damage
await page.locator('.section-title', { hasText: 'Damage' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: join(out, '03-all-sections.png') });

// Compare view and 1:1.
await page.keyboard.down('\\');
await page.waitForTimeout(100);
await page.screenshot({ path: join(out, '04-compare.png') });
await page.keyboard.up('\\');
await page.locator('.toolbar .chip', { hasText: '1:1' }).click();
await page.waitForTimeout(100);
await page.screenshot({ path: join(out, '05-actual.png') });
await page.locator('.toolbar .chip', { hasText: 'Fit' }).click();

// Export: the browser host downloads a TIFF.
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.btn-primary', { hasText: 'Export' }).click(),
]);
const exported = join(out, 'lamp-Halation.tif');
await download.saveAs(exported);
await browser.close();
server.close();

// Verify with ImageMagick: dimensions, depth, and a red halo around the big lamp.
const info = execSync(`identify -format "%w %h %z %[colorspace]" "${exported}"`).toString().trim();
console.log('exported:', info);
const [w, h, depth] = info.split(' ').map(Number);
if (w !== 640 || h !== 427 || depth !== 16) throw new Error(`unexpected export geometry: ${info}`);

// Mean colour of a 9x9 patch, so grain noise averages out.
const sample = (file, x, y) => execSync(`convert "${file}" -crop 9x9+${x - 4}+${y - 4} +repage -resize 1x1! -format "%[fx:r] %[fx:g] %[fx:b]" info:`).toString().trim().split(' ').map(Number);
const src = join(here, 'fixtures', 'lamp16-zip.tif');
// 40 px to the right of the big lamp (480,300): outside the lamp, inside the halation radius.
const before = sample(src, 520, 300);
const after = sample(exported, 520, 300);
console.log('halo sample before/after:', before, after);
const redLift = (after[0] - after[2]) - (before[0] - before[2]);
if (redLift < 0.02) throw new Error('expected a warm halation lift next to the lamp');
// Far corner should be essentially unchanged apart from grain.
const cornerBefore = sample(src, 20, 400);
const cornerAfter = sample(exported, 20, 400);
if (Math.abs(cornerBefore[1] - cornerAfter[1]) > 0.12) throw new Error('corner changed more than grain should');
console.log('e2e ok');
