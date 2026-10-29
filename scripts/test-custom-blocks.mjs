import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('BROWSER ERROR:', error.stack ?? error.message));
  page.on('console', msg => { if(msg.type() !== 'log') console.error('BROWSER CONSOLE', msg.type(), msg.text()); });
  page.on('response', response => { if(response.status() >= 400) console.error('BROWSER RESPONSE', response.status(), response.url()); });
  await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });

  const header = page.locator('.sheet-content .sheet-header').first();
  await header.click({ button: 'right' });
  await page.evaluate(() => {
    window.__trace = [];
    document.addEventListener('click', (event) => {
      window.__trace.push('capture:' + event.target?.outerHTML?.slice(0, 140));
    }, true);
    document.addEventListener('click', (event) => {
      window.__trace.push('bubble:' + event.target?.outerHTML?.slice(0, 140));
    });
    window.addEventListener('beforeunload', () => console.log('BEFORE UNLOAD'), { once:true });
  });
  console.log('Menu before click', await page.getByRole('button', { name: 'Save as custom block' }).evaluate(el => el.outerHTML));
  await page.getByRole('button', { name: 'Save as custom block' }).click();
  console.log('Trace', await page.evaluate(() => window.__trace));
  console.log('URL', page.url());
  console.log('Body status', (await page.locator('body').innerText()).slice(0,600));
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

  // Custom block structure is protected in the sheet, but leaf values are editable.
  const beforeChildren = await instance.locator('[data-sheet-text], [data-sheet-block]').count();
  await title.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  const afterChildren = await instance.locator('[data-sheet-text], [data-sheet-block]').count();
  assert.equal(afterChildren, beforeChildren, 'Cannot delete custom block descendants individually');
  // Restore the typed override for the export/import assertion.
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('!');
  assert.match(await title.innerText(), /!/);

  const source = page.locator('.source-panel').first().locator('.cm-content');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await source.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  const serialized = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
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
  // A rejected import must leave BOTH the sheet and reactive fields unchanged.
  const invalid = structuredClone(serialized);
  invalid.fields['NOT A VALID ID'] = { id: 'NOT A VALID ID', formula: '42' };
  await importSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(invalid));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  assert.match(await page.locator('[role="status"]').innerText(), /Import failed: Invalid formula field/);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await importSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  const afterInvalid = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.deepEqual(afterInvalid.fields, serialized.fields, 'Rejected import must preserve fields');

  // The JSON editor has an explicit Apply action. Save must not silently
  // discard unapplied JSON edits and keep the older preview tree.
  await page.getByRole('button', { name: 'Edit Test Header' }).click();
  const editModal = page.getByRole('dialog', { name: 'Custom block definition editor' });
  await editModal.waitFor();
  const structureSource = editModal.locator('.source-pane .cm-content');
  await structureSource.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' ');
  await editModal.getByRole('button', { name: 'Save definition' }).click();
  assert.match(await editModal.getByRole('alert').innerText(), /Unapplied JSON changes/);
  await editModal.getByRole('button', { name: 'From preview' }).click();

  // Unsaved CSS must not leak from the preview into the sheet behind the modal.
  const originalColor = await page.locator('.sheet-content [data-custom-block-type="sheet-header"] .sheet-title')
    .first().evaluate(node => getComputedStyle(node).color);
  await editModal.getByRole('button', { name: 'CSS', exact: true }).click();
  const cssSource = editModal.locator('.source-pane .cm-content');
  await cssSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('.sheet-title { color: rgb(1, 2, 3) !important; }');
  const sheetColor = await page.locator('.sheet-content [data-custom-block-type="sheet-header"] .sheet-title')
    .first().evaluate(node => getComputedStyle(node).color);
  assert.equal(sheetColor, originalColor, 'Draft CSS must be scoped to modal preview');
  await editModal.getByRole('button', { name: 'Save definition' }).click();
  console.log('After CSS save', { alerts: await editModal.locator('[role="alert"]').allTextContents(), status: await page.locator('[role="status"]').allTextContents(), visible: await editModal.isVisible() });
  await editModal.waitFor({ state: 'hidden', timeout: 2500 });
  console.log('Import atomicity, unapplied JSON protection, CSS draft containment passed');
} finally {
  await browser.close();
}
