// Shared with test-custom-blocks.mjs so this regression runs in browser CI.
export async function testContainerContextMenu(page) {
  const canvas = page.locator('.sheet-content .tiptap').first();
  const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
  const menu = page.getByRole('menuitem', { name: 'Save as custom block', exact: true });
  const cases = [
    { selector: '.stats-grid', surface: '.stat-card', edge: 'top', gap: true,
      classes: 'stats-grid', children: ['stat-card', 'stat-card', 'stat-card', 'stat-card'] },
    { selector: '.stats-grid', surface: '.stat-card', edge: 'bottom', gap: true,
      classes: 'stats-grid', children: ['stat-card', 'stat-card', 'stat-card', 'stat-card'] },
    { selector: '.stat-card', edge: 'top', classes: 'stat-card',
      children: ['stat-label', 'stat-number', 'stat-mod'] },
    { selector: '.sheet-header', edge: 'bottom', classes: 'sheet-header',
      children: ['sheet-title', 'sheet-subtitle'] }
  ];

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const testCase of cases) {
    for (let attempt = 0; attempt < 2; attempt++) {
      // Start with a child caret, including after returning from the modal.
      await canvas.locator('.sheet-title').click();
      const container = canvas.locator(testCase.selector).first();
      await container.scrollIntoViewIfNeeded();
      const surface = testCase.surface ? container.locator(testCase.surface).first() : container;
      const rect = await surface.boundingBox();
      if (!rect) throw new Error(`Missing surface: ${testCase.selector}`);
      const x = testCase.gap ? rect.x + rect.width + 7 : rect.x + 5;
      const y = testCase.edge === 'bottom' ? rect.y + rect.height - 5 : rect.y + 5;
      await page.mouse.move(x, y);
      if (!(await container.evaluate((element) =>
        ['dashed', 'solid'].includes(getComputedStyle(element).outlineStyle)))) {
        throw new Error(`Expected container hover: ${testCase.classes} (${testCase.edge})`);
      }

      await page.mouse.click(x, y, { button: 'right' });
      await menu.waitFor({ state: 'visible' });
      // Allow native selectionchange/DOM observer work to settle too.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const selectedType = await page.locator('.selection-heading strong').innerText();
      const selectedClasses = await page.getByLabel('Selected block CSS classes').inputValue();
      if (selectedType !== 'container' || selectedClasses !== testCase.classes ||
          !await container.evaluate(element => element.classList.contains('ProseMirror-selectednode'))) {
        throw new Error(`Right-click on ${testCase.classes} (${testCase.edge}) selected ${selectedType} .${selectedClasses}`);
      }

      await menu.hover();
      if (await container.evaluate(element => getComputedStyle(element).outlineStyle) !== 'dashed') {
        throw new Error(`Save hover must preview ${testCase.classes}, including selected containers`);
      }
      await page.getByRole('menuitem', { name: 'View properties', exact: true }).hover();
      if (await container.evaluate(element => getComputedStyle(element).outlineStyle) !== 'solid') {
        throw new Error('Leaving Save must restore the container selection outline');
      }
      await menu.click();
      if (await canvas.locator('[data-rbb-context-hovered]').count()) {
        throw new Error('Closing the menu must clear its save target');
      }
      await modal.waitFor({ state: 'visible' });
      const name = await modal.getByLabel('Custom block name').inputValue();
      const root = modal.locator('.preview .tiptap > section');
      const children = await root.locator(':scope > *').evaluateAll(elements =>
        elements.map(element => element.getAttribute('class')));
      if (name !== testCase.classes || !await root.evaluate((element, cls) => element.classList.contains(cls), testCase.classes) ||
          JSON.stringify(children) !== JSON.stringify(testCase.children)) {
        throw new Error(`Context action captured wrong subtree for ${testCase.classes}: ${name}, ${JSON.stringify(children)}`);
      }
      await modal.getByRole('button', { name: 'Close editor', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
    }
  }
  // A leaf keeps its selection while Save previews only its enclosing container.
  const label = canvas.locator('.stat-label').first();
  const enclosing = canvas.locator('.stat-card').first();
  await label.click({ button: 'right' });
  await menu.hover();
  if (await enclosing.evaluate(element => getComputedStyle(element).outlineStyle) !== 'dashed' ||
      await canvas.locator('.stats-grid').evaluate(element => getComputedStyle(element).outlineStyle) === 'dashed' ||
      await page.getByLabel('Selected block CSS classes').inputValue() !== 'stat-label') {
    throw new Error('Save must highlight the nearest container without changing the leaf selection');
  }
  await page.getByRole('menuitem', { name: 'View properties', exact: true }).hover();
  if (await enclosing.evaluate(element => getComputedStyle(element).outlineStyle) === 'dashed') {
    throw new Error('Leaving Save must clear the enclosing-container preview');
  }
  await page.locator('.topbar h1').click();
  if (await canvas.locator('[data-rbb-context-hovered]').count()) {
    throw new Error('Outside dismissal must clear the save target');
  }
  console.log('Container right-click: hover, selection and captured subtree match across repeated clicks');
}
