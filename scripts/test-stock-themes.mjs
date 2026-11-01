import assert from 'node:assert/strict';

/** Run against a fresh page/context in the embedded browser. */
export async function testStockThemes(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
	const canvas = page.locator('.main-pane .sheet-document');
	const panel = page.locator('.source-panel').nth(1);
	const target = page.getByRole('combobox', { name: 'Theme stylesheet' });
	const select = async (section) => {
		const labels = {
			base: 'Shared',
			container: 'Container',
			textBlock: 'Text',
			formula: 'Formula',
			image: 'Image'
		};
		await target.click();
		await page
			.getByRole('option', { name: new RegExp('^' + labels[section] + '( [*])?$') })
			.click();
	};
	const source = page.getByRole('textbox', { name: 'Theme CSS', exact: true });
	const image = canvas.locator('.rbb-image').first();
	const wrapper = canvas.locator('[data-sheet-block="image"]').first();
	const css = '.sheet-content [data-sheet-block="image"] { border: 3px solid rgb(1, 2, 3); }';
	const textCSS = '.sheet-content [data-sheet-text] { color: rgb(4, 5, 6); }';
	const replace = async (value) => {
		await source.click();
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.insertText(value);
	};
	const radius = () => image.evaluate((element) => getComputedStyle(element).borderRadius);
	const border = () => wrapper.evaluate((element) => getComputedStyle(element).borderTopWidth);
	const reload = async () => {
		await page.reload({ waitUntil: 'domcontentloaded' });
		await panel.getByRole('button', { name: 'Save', exact: true }).waitFor();
		await select('image');
	};

	await canvas.locator('.sheet-title').waitFor();
	assert.equal(await radius(), '8px');
	await wrapper.click();
	await page.getByRole('button', { name: 'Edit theme CSS', exact: true }).click();
	assert.equal(await target.innerText(), 'Image');
	assert.match(await source.innerText(), /rbb-image/);

	// Full replacement removes the stock radius, instead of layering over it.
	await replace(css);
	assert.equal(await border(), '3px');
	assert.equal(await radius(), '0px');
	await select('textBlock');
	await replace(textCSS);
	await select('image');
	assert.equal(await source.innerText(), css);
	assert.equal(
		await canvas.locator('.sheet-title').evaluate((el) => getComputedStyle(el).color),
		'rgb(4, 5, 6)'
	);

	// Shared remains editable while the canvas still has an image selected.
	await select('base');
	assert.equal(await page.locator('.selection-heading strong').innerText(), 'image');
	await replace('.sheet-content { color: rgb(20, 21, 22); }');
	assert.equal(
		await page.locator('.main-pane .sheet-content').evaluate((el) => getComputedStyle(el).color),
		'rgb(20, 21, 22)'
	);
	await select('image');
	assert.equal(await source.innerText(), css);

	// Save applies to this stylesheet only; other drafts do not survive reload.
	await panel.getByRole('button', { name: 'Save', exact: true }).click();
	await reload();
	assert.equal(await source.innerText(), css);
	assert.equal(await border(), '3px');
	assert.equal(
		await canvas.locator('.sheet-title').evaluate((el) => getComputedStyle(el).color),
		'rgb(49, 45, 42)'
	);

	await replace('.sheet-content [data-sheet-block="image"] { border: 9px solid red; }');
	assert.equal(await border(), '9px');
	await panel.getByRole('button', { name: 'Discard', exact: true }).click();
	assert.equal(await border(), '3px');
	await panel.getByRole('button', { name: 'Reset to default', exact: true }).click();
	assert.equal(await radius(), '8px');
	await panel.getByRole('button', { name: 'Discard', exact: true }).click();
	assert.equal(await radius(), '0px');
	assert.equal(await border(), '3px');
	await panel.getByRole('button', { name: 'Reset to default', exact: true }).click();
	await panel.getByRole('button', { name: 'Save', exact: true }).click();
	await reload();
	assert.equal(await radius(), '8px');

	// Empty is an intentional stylesheet, not a request to fall back to defaults.
	await replace('');
	await panel.getByRole('button', { name: 'Save', exact: true }).click();
	await reload();
	assert.equal((await source.innerText()).trim(), '');
	assert.equal(
		await page.evaluate(() => localStorage.getItem('rbb:themes/default/stock-blocks/image.css')),
		''
	);
	assert.equal(await radius(), '0px');

	// Stock styles also apply inside the definition preview.
	await replace(css);
	await canvas.locator('.sheet-footer').click({ button: 'right', position: { x: 4, y: 4 } });
	await page.getByRole('button', { name: 'Save as custom block', exact: true }).click();
	const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
	await modal.waitFor();
	assert.equal(
		await modal
			.locator('[data-sheet-block="image"]')
			.evaluate((el) => getComputedStyle(el).borderTopWidth),
		'3px'
	);
	await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
	assert.deepEqual(errors, []);
	console.log(
		'Stock theme selection, replacement, drafts, persistence, discard, reset and preview passed'
	);
}
