import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { testContainerContextMenu } from './test-container-context-menu.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('BROWSER ERROR:', error.stack ?? error.message));
  page.on('console', msg => { if(msg.type() !== 'log') console.error('BROWSER CONSOLE', msg.type(), msg.text()); });
  page.on('response', response => { if(response.status() >= 400) console.error('BROWSER RESPONSE', response.status(), response.url()); });
  await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });

  await testContainerContextMenu(page);

  const header = page.locator('.sheet-content .sheet-header').first();
  await header.click({ button: 'right' });
  const contextAction = page.locator('.context-action');
  await contextAction.waitFor({ state: 'visible' });
  // Clicking elsewhere dismisses the menu without consuming the click.
  await page.locator('.topbar h1').click();
  await contextAction.waitFor({ state: 'hidden' });
  // Opening the menu again must still allow its own action to run.
  await header.click({ button: 'right' });
  await contextAction.waitFor({ state: 'visible' });
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
  await page.locator('#sync-sheet-json').click();
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
  await page.locator('#apply-sheet-json').click();
  assert.match(await page.locator('.sheet-content [data-custom-block-type="sheet-header"] .sheet-title').first().innerText(), /!/);

  const missing = structuredClone(serialized);
  missing.document.content[0].attrs.typeId = 'not-installed';
  await importSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(missing));
  await page.locator('#apply-sheet-json').click();
  assert.match(await page.locator('[role="status"]').innerText(), /Import failed: Missing custom block definition: not-installed/);
  assert.equal(await page.locator('.sheet-content [data-custom-block-type="sheet-header"]').count(), 1);
  // A rejected import must leave BOTH the sheet and reactive fields unchanged.
  const invalid = structuredClone(serialized);
  invalid.fields['NOT A VALID ID'] = { id: 'NOT A VALID ID', formula: '42' };
  await importSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(invalid));
  await page.locator('#apply-sheet-json').click();
  assert.match(await page.locator('[role="status"]').innerText(), /Import failed: Invalid formula field/);
  await page.locator('#sync-sheet-json').click();
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

  // End-to-end nested definitions: parent-specific defaults survive save,
  // while the referenced child definition retains its shared default.
  const childDefinition = {
    typeId: 'test-nested-child', name: 'Nested Child', rootClass: '',
    structure: { type: 'container', attrs: { nodeId: 'child-root', class: 'child-root' },
      content: [{ type: 'textBlock', attrs: { nodeId: 'child-leaf', class: 'child-label' },
        content: [{ type: 'text', text: 'Global child default' }] }] }
  };
  const parentDefinition = {
    typeId: 'test-nested-parent', name: 'Nested Parent', rootClass: '',
    structure: { type: 'container', attrs: { nodeId: 'parent-root', class: 'parent-root' },
      content: [{ type: 'customBlock', attrs: {
        nodeId: 'nested-slot', typeId: 'test-nested-child', instanceId: 'definition-nested-slot',
        values: {}
      } }] }
  };
  await page.evaluate(([child, parent]) => {
    localStorage.setItem('rbb:custom-blocks/' + child.typeId + '.json', JSON.stringify(child));
    localStorage.setItem('rbb:custom-blocks/' + parent.typeId + '.json', JSON.stringify(parent));
  }, [childDefinition, parentDefinition]);
  await page.reload({ waitUntil: 'networkidle' });
  const nestedSheet = {
    version: 1, themeId: 'default', fields: serialized.fields,
    document: { type: 'doc', content: [
      { type: 'customBlock', attrs: { typeId: 'test-nested-parent', instanceId: 'sheet-parent', values: {} } },
      { type: 'customBlock', attrs: { typeId: 'test-nested-child', instanceId: 'sheet-child', values: {} } }
    ] }
  };
  const nestedSource = page.locator('.source-panel').first().locator('.cm-content');
  await nestedSource.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(nestedSheet));
  await page.locator('#apply-sheet-json').click();
  assert.equal(await page.locator('.sheet-content .parent-root .child-label').first().innerText(), 'Global child default');
  // Dragging a nested component on the sheet must expose only the outer
  // custom-block handle, not the child definition's internal structure.
  await page.getByRole('button', { name: 'Drag', exact: true }).first().click();
  await page.locator('.sheet-content .parent-root .child-label').first().hover();
  const handles = page.locator('.sheet-content .rbb-block-drag-rail:not([hidden]) .rbb-block-drag-handle');
  assert.equal(await handles.count(), 1, 'Nested child should have no separate sheet drag handle');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();

  await page.getByRole('button', { name: 'Edit Nested Parent' }).click();
  const parentModal = page.getByRole('dialog', { name: 'Custom block definition editor' });
  await parentModal.locator('.preview .child-label').click();
  const nestedInput = parentModal.getByLabel('Nested child-label value');
  await nestedInput.waitFor();
  await nestedInput.fill('Parent-only default');
  await parentModal.getByRole('button', { name: 'Save definition' }).click();
  await parentModal.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sheet-content .parent-root .child-label').first().innerText(), 'Parent-only default');

  // Live definition evolution: insert a sibling before the nested component
  // while preserving the parent-only nested override in the open sheet.
  await page.getByRole('button', { name: 'Edit Nested Parent' }).click();
  const evolutionModal = page.getByRole('dialog', { name: 'Custom block definition editor' });
  const definitionJSON = evolutionModal.locator('.source-pane .cm-content');
  await definitionJSON.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  const structure = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  structure.content.unshift({
    type: 'textBlock',
    attrs: { nodeId: 'new-sibling', class: 'new-sibling' },
    content: [{ type: 'text', text: 'Added later' }]
  });
  await definitionJSON.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(JSON.stringify(structure));
  await evolutionModal.getByRole('button', { name: 'Apply JSON' }).click();
  await evolutionModal.getByRole('button', { name: 'Save definition' }).click();
  await evolutionModal.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.sheet-content .parent-root .new-sibling').first().innerText(), 'Added later');
  assert.equal(await page.locator('.sheet-content .parent-root .child-label').first().innerText(), 'Parent-only default');
  assert.equal(await page.locator('.sheet-content > div .child-root').last().locator('.child-label').innerText(), 'Global child default');

  await page.getByRole('button', { name: 'Edit Nested Parent' }).click();
  const parentAgain = page.getByRole('dialog', { name: 'Custom block definition editor' });
  await parentAgain.locator('.preview .child-label').click();
  await parentAgain.getByRole('button', { name: 'Edit definition' }).click();
  await page.getByRole('dialog', { name: 'Custom block definition editor' })
    .getByLabel('Custom block name').fill('Renamed Child');
  await page.getByRole('dialog', { name: 'Custom block definition editor' })
    .getByRole('button', { name: 'Save definition' }).click();
  await page.getByRole('dialog', { name: 'Custom block definition editor' })
    .getByText('Nested Parent').waitFor();
  await page.getByRole('dialog', { name: 'Custom block definition editor' })
    .getByRole('button', { name: 'Cancel' }).click();
  console.log('Nested definition editing, inherited values and navigation passed');

} finally {
  await browser.close();
}
