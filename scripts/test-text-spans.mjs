import assert from 'node:assert/strict';

export async function testTextSpans(page) {
	const canvas = page.locator('.main-pane .sheet-document');
	const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
	const original = await canvas.evaluate((element) => element.editor.getJSON());
	try {
		// Serialization and rendering use stock spans.
		const html = await canvas.evaluate((element) => {
			element.editor.commands.setContent(
				'<section data-sheet-container class="span-test-row">' +
					'<span data-sheet-text class="stat-label">VALUE</span>' +
					'<cs-formula class="stat-number" field="STR"></cs-formula>' +
					'</section>'
			);
			return element.editor.getHTML();
		});
		assert.match(html, /<span[^>]+data-sheet-text/);
		assert.equal(await canvas.locator('p[data-sheet-text]').count(), 0);

		// The row's layout comes from public sheet selectors in Theme CSS.
		const theme = page.getByRole('textbox', { name: 'Theme CSS', exact: true });
		await theme.click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText(
			'\n.sheet-content .span-test-row { display: flex; align-items: center; gap: 8px; }'
		);

		const label = canvas.locator('span.stat-label');
		await label.click();
		await page.keyboard.press('End');
		await page.keyboard.insertText('!');
		assert.equal(await label.innerText(), 'VALUE!');
		await label.hover();
		assert.equal(await label.getAttribute('data-rbb-hovered'), null);
		assert.equal(await label.evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
		await page.getByRole('button', { name: 'Drag', exact: true }).click();
		await label.hover();
		const handles = page.locator('.main-pane .rbb-block-drag-rail button');
		assert.equal(await handles.count(), 2, 'Container and span have separate handles');
		await handles.last().click();
		assert.equal(await page.locator('.selection-heading strong').innerText(), 'textBlock');
		await page.getByRole('button', { name: 'Edit', exact: true }).click();

		await canvas.locator('.span-test-row').click({ button: 'right' });
		await page.getByRole('button', { name: 'Save as custom block', exact: true }).click();
		await modal.waitFor({ state: 'visible' });
		const layouts = await page.evaluate(() => {
			return ['.main-pane', '.rbb-definition-preview'].map((selector) => {
				const row = document.querySelector(selector + ' .span-test-row');
				const label = row.querySelector('[data-sheet-text]');
				const value = row.querySelector('[data-sheet-block="formula"]');
				const rowRect = row.getBoundingClientRect();
				const styles = getComputedStyle(label);
				return {
					tag: label.tagName,
					margin: styles.margin,
					fontSize: styles.fontSize,
					height: rowRect.height,
					labelOffset: label.getBoundingClientRect().top - rowRect.top,
					valueOffset: value.getBoundingClientRect().top - rowRect.top
				};
			});
		});
		assert.equal(layouts[0].tag, 'SPAN');
		assert.equal(layouts[0].margin, '0px');
		assert.deepEqual(layouts[0], layouts[1], 'Sheet and definition use the same text layout');
		await modal.getByRole('button', { name: 'Close editor', exact: true }).click();

		// Without a theme, text items keep native inline layout, without a reset.
		const unthemed = await canvas.evaluate((element) => {
			const theme = document.querySelector('style[data-reactive-block-builder]');
			const css = theme.textContent;
			try {
				theme.textContent = '';
				const label = element.querySelector('[data-sheet-text]');
				return { display: getComputedStyle(label).display, margin: getComputedStyle(label).margin };
			} finally {
				theme.textContent = css;
			}
		});
		assert.deepEqual(unthemed, { display: 'inline', margin: '0px' });
		console.log('Text spans: HTML, editing, handles, and preview alignment passed');
	} finally {
		if (await modal.isVisible()) {
			await modal.getByRole('button', { name: 'Close editor', exact: true }).click();
		}
		await canvas.evaluate(
			(element, document) => element.editor.commands.setContent(document),
			original
		);
		await page
			.locator('.source-panel')
			.nth(1)
			.getByRole('button', { name: 'Discard', exact: true })
			.click();
	}
}
