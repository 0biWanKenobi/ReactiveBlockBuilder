import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });

  const workspace = page.locator('.workspace');
  const header = page.locator('.topbar');
  const canvas = page.locator('.sheet-frame');
  const sidebar = page.locator('#block-palette-pane aside');
  const inspector = page.locator('#inspector-pane aside');
  const tools = page.locator('.pane-title');
  const sources = page.locator('.source-panels');
  const title = page.locator('.sheet-title').first();

  await title.waitFor({ state: 'visible' });
  const originalText = await title.innerText();
  const designWidth = (await canvas.boundingBox()).width;
  assert.equal(await sidebar.isVisible(), true);
  assert.equal(await sources.isVisible(), true);

  await title.hover();
  assert.equal(await page.locator('.sheet-content [data-rbb-hovered]').count(), 1);
  await page.locator('.mode-switch button').nth(1).click();
  await page.waitForTimeout(650);
  assert.equal(await header.isVisible(), true);
  assert.equal(await title.isVisible(), true);
  assert.equal(await workspace.evaluate(node => node.classList.contains('playing')), true);
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await inspector.isVisible(), false);
  assert.equal(await tools.isVisible(), false);
  assert.equal(await sources.isVisible(), false);
  const playWidth = (await canvas.boundingBox()).width;
  assert(playWidth > designWidth + 100, `Canvas should expand: ${designWidth} to ${playWidth}`);
  assert.equal(await title.innerText(), originalText);
  assert.equal(await page.locator('.sheet-content .tiptap').getAttribute('contenteditable'), 'false');
  await title.hover();
  assert.equal(await page.locator('.sheet-content [data-rbb-hovered]').count(), 0);
  assert.equal(await page.locator('.sheet-header').first().evaluate(el => getComputedStyle(el).outlineStyle), 'none');

  await page.locator('.mode-switch button').nth(0).click();
  await page.waitForTimeout(650);
  assert.equal(await sidebar.isVisible(), true);
  assert.equal(await inspector.isVisible(), true);
  assert.equal(await tools.isVisible(), true);
  assert.equal(await sources.isVisible(), true);
  assert.equal(await title.innerText(), originalText);
  assert.equal(await page.locator('.sheet-content .tiptap').getAttribute('contenteditable'), 'true');
  assert(Math.abs((await canvas.boundingBox()).width - designWidth) < 2);
  assert.deepEqual(errors, []);
  console.log('Play-mode transition, canvas expansion, and restoration passed');
} finally {
  await browser.close();
}
