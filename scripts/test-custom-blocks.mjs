import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => console.error('BROWSER ERROR:', error.stack ?? error.message));
  await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });

  const header = page.locator('.sheet-content .sheet-header').first();
  await header.click({ button: 'right' });
  await page.getByRole('button', { name: 'Save as custom block' }).click();
  const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
  console.log('After creation:', {
    dialogs: await page.locator('[role="dialog"]').count(),
    status: await page.locator('[role="status"]').allTextContents(),
    contextActions: await page.getByRole('button', { name: 'Save as custom block' }).count()
  });
  await modal.waitFor({ timeout: 5000 });
  await modal.getByLabel('Custom block name').fill('Test Header');
  await modal.getByRole('button', { name: 'Save definition' }).click();
  const confirm = page.getByRole('dialog', { name: 'Saved custom block' });
  await confirm.waitFor();
  await confirm.getByRole('button', { name: 'Replace original' }).click();

  const instance = page.locator('.sheet-content [data-custom-block-type="sheet-header"]').first();
  await instance.waitFor({ state: 'visible' });
  const title = instance.locator('.sheet-title').first();
  assert.match(await title.innerText(), /THE WANDERING ARTIFICER/);

  // Nested text remains editable as a value, without copying the structure into sheet JSON.
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('!');
  assert.match(await title.innerText(), /!/);

  const source = page.locator('.source-panel').first().locator('.cm-content');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const serialized = JSON.parse(await source.innerText());
  assert.equal(serialized.themeId, 'default');
  assert.equal('css' in serialized, false);
  const compact = serialized.document.content[0];
  assert.equal(compact.type, 'customBlock');
  assert.equal(compact.attrs.typeId, 'sheet-header');
  assert.equal(compact.content, undefined);
  assert(Object.keys(compact.attrs.values).length > 0, 'Edited child must create an instance override');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Edit Test Header' }).waitFor();
  const importSource = page.locator('.source-panel').first().locator('.cm-content');
  await importSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(serialized));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  assert.match(await page.locator('.sheet-content [data-custom-block-type="sheet-header"] .sheet-title').first().innerText(), /!/);

  const missing = structuredClone(serialized);
  missing.document.content[0].attrs.typeId = 'not-installed';
  await importSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(missing));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  assert.match(await page.locator('[role="status"]').innerText(), /Import failed: Missing custom block definition: not-installed/);
  assert.equal(await page.locator('.sheet-content [data-custom-block-type="sheet-header"]').count(), 1);
  console.log('Custom block creation, compact overrides, persistence, import failure passed');
} finally {
  await browser.close();
}
