// Optional browser QA. The solver, benchmark and site have no npm dependencies.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:8080/' },
  screenshots: { type: 'string' },
  engine: { type: 'string', default: 'chromium' }
} });
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await playwright[values.engine].launch({ headless: true, channel: process.env.BROWSER_CHANNEL });
if (values.screenshots) await mkdir(values.screenshots, { recursive: true });

try {
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => errors.push(r.url() + ' ' + r.failure()?.errorText));
    page.on('response', r => { if (r.status() >= 400) errors.push(r.url() + ' ' + r.status()); });
    await page.goto(values.url);
    const view = id => page.locator('#' + id);
    await page.waitForFunction(() => document.querySelector('#depthError')?.textContent === '10.63 mm');
    assert.equal(await view('play').textContent(), 'Play');
    assert.equal(await view('timeLabel').textContent(), '4.0 s');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (values.screenshots) {
      await page.screenshot({ path: join(values.screenshots, name + '.png'), fullPage: true });
    }
    await view('step').click();
    assert.equal(await view('timeLabel').textContent(), '4.1 s');
    await view('play').click();
    await page.waitForFunction(() => Number(document.querySelector('#time').value) >= 43);
    await view('play').click();
    assert.equal(await view('play').textContent(), 'Play');
    await view('restart').click();
    assert.equal(await view('timeLabel').textContent(), '0.0 s');
    await view('release').selectOption('still');
    await view('time').focus();
    await page.keyboard.press('End');
    assert.equal(await view('step').isDisabled(), true);
    assert.equal(await view('gDepth').textContent(), '1.500 m');
    assert.equal(await view('gSpeed').textContent(), '0.000 m/s');
    assert.equal(await view('depthError').textContent(), '0.00 mm');
    await view('position').focus();
    await page.keyboard.press('Home');
    assert.equal(await view('positionLabel').textContent(), '-60.0 m');
    await view('mesh').selectOption('960');
    await view('release').selectOption('gentle');
    assert.equal(await view('upLabel').textContent(), '1.6 m');
    await view('upstream').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await view('release').inputValue(), 'custom');
    await view('overlay').uncheck();
    const map = await view('history').boundingBox();
    await view('history').click({ position: { x: map.width * 0.72, y: map.height * 0.43 } });
    assert.ok(Number(await view('position').inputValue()) > 0);
    assert.ok(Number(await view('time').inputValue()) < 80);
    const receipt = await page.request.get(new URL('./benchmark.json', values.url).href);
    assert.equal(receipt.status(), 200);
    assert.equal((await receipt.json()).gate_release.grids.length, 4);
    assert.deepEqual(errors, []);
    console.log(values.engine, name, 'passed');
    await page.close();
  }
} finally {
  await browser.close();
}
