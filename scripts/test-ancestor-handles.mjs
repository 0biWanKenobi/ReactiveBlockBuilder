import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => console.error('BROWSER ERROR:', error.stack ?? error.message));
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.error('CONSOLE:', msg.text()); });
  const response = await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200);
  assert.equal(await page.locator('.sheet-content .tiptap').count(), 1);
  const title = page.locator('.sheet-content .sheet-title').first();
  await title.waitFor({ state: 'visible', timeout: 10000 }).catch(async (error) => {
    console.error('TITLE NOT FOUND. BODY:', (await page.locator('body').innerText()).slice(0, 3000));
    console.error('HTML:', (await page.content()).slice(0, 3000));
    throw error;
  });
  await title.hover();
  const rail = page.locator('.rbb-block-drag-rail');
  const handles = rail.locator('button');
  await handles.first().waitFor({ state: 'visible' });
  assert.equal(await handles.count(), 2, 'header and title must have separate handles');

  const labels = await handles.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label'))
  );
  assert.match(labels[0] ?? '', /container.*sheet-header/);
  assert.match(labels[1] ?? '', /text.*sheet-title/);

  const before = await title.boundingBox();
  const header = page.locator('.sheet-content .sheet-header').first();
  const headerBefore = await header.boundingBox();
  assert(before && headerBefore);

  const current = await title.boundingBox();
  const destination = await handles.first().boundingBox();
  assert(current && destination);
  for (let step = 1; step <= 30; step++) {
    const x = current.x + current.width / 2 + (destination.x + destination.width / 2 - current.x - current.width / 2) * step / 30;
    const y = current.y + current.height / 2 + (destination.y + destination.height / 2 - current.y - current.height / 2) * step / 30;
    await page.mouse.move(x, y);
    const info = await page.evaluate(({x,y}) => {
      const rail = document.querySelector('.rbb-block-drag-rail');
      return { hidden: rail?.hidden, buttons: rail?.querySelectorAll('button').length };
    }, {x,y});
    assert.equal(info.hidden, false, `Handles vanished at step ${step}`);
    assert.equal(info.buttons, 2, `Handles changed at step ${step}`);
  }
  await handles.first().hover();
  assert.equal(await rail.isVisible(), true, 'rail must remain visible while hovering grip');
  assert.equal(await page.locator('.rbb-block-highlight-overlay').isVisible(), true);

  await handles.first().click();
  assert.equal(await page.locator('.selection-heading strong').innerText(), 'container');

  await title.hover();
  await handles.nth(1).hover();
  assert.equal(await page.locator('.rbb-block-highlight-overlay').isVisible(), true);
  await handles.nth(1).click();
  assert.equal(await page.locator('.selection-heading strong').innerText(), 'textBlock');

  const after = await title.boundingBox();
  const headerAfter = await header.boundingBox();
  assert(before && after && headerBefore && headerAfter);
  assert(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1,
    'handles must not move title or change document layout');
  assert(Math.abs(headerBefore.width - headerAfter.width) < 1,
    'handles must not resize the parent container');

  // Regression: full sheet-root -> header -> title/subtitle, moving down
  // and then up must recalculate ancestors on every actual block hover.
  const source = page.locator('.source-panel').first().locator('.cm-content');
  const original = {
    version: 1,
    document: {
      type: 'doc',
      content: [{
        type: 'container', attrs: { class: 'sheet-root' },
        content: [{
          type: 'container', attrs: { class: 'sheet-header' },
          content: [
            { type: 'textBlock', attrs: { class: 'sheet-title' },
              content: [{ type: 'text', text: 'THE WANDERING ARTIFICER' }] },
            { type: 'textBlock', attrs: { class: 'sheet-subtitle' },
              content: [{ type: 'text', text: 'A reactive character sheet built from nested blocks' }] }
          ]
        }]
      }]
    },
    css: '.sheet-content .sheet-header { padding-bottom: 18px; } .sheet-content .sheet-title { font-size: 1.45rem; }',
    fields: { STR: { id: 'STR', formula: '16' } }
  };
  await source.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(original));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const rootTitle = page.locator('.sheet-content .sheet-title').first();
  const subtitle = page.locator('.sheet-content .sheet-subtitle').first();
  const headerElement = page.locator('.sheet-content .sheet-header').first();
  async function expectHandles(element, classes) {
    await element.hover();
    const names = await page.locator('.rbb-block-drag-rail button').evaluateAll(
      (buttons) => buttons.map((button) => button.getAttribute('title'))
    );
    assert.deepEqual(names, classes.map((cls) => cls), 'Hover ancestry must match the pointer target');
  }
  await expectHandles(rootTitle, ['container .sheet-root', 'container .sheet-header', 'text .sheet-title']);
  await expectHandles(subtitle, ['container .sheet-root', 'container .sheet-header', 'text .sheet-subtitle']);
  const subtitleRect = await subtitle.boundingBox();
  const headerRect = await headerElement.boundingBox();
  assert(subtitleRect && headerRect);
  // Header's bottom padding belongs to the header, not either text child.
  await page.mouse.move(subtitleRect.x + 12, Math.min(headerRect.y + headerRect.height - 4, subtitleRect.y + subtitleRect.height + 8));
  assert.deepEqual(await page.locator('.rbb-block-drag-rail button').evaluateAll(
    (buttons) => buttons.map((button) => button.getAttribute('title'))),
    ['container .sheet-root', 'container .sheet-header']);
  await expectHandles(subtitle, ['container .sheet-root', 'container .sheet-header', 'text .sheet-subtitle']);
  await expectHandles(rootTitle, ['container .sheet-root', 'container .sheet-header', 'text .sheet-title']);
  console.log('Nested sheet-root downward/upward hover sequence passed');
  console.log('Ancestor handles: visible, labeled, highlighted, selectable, and layout-neutral');
} finally {
  await browser.close();
}
