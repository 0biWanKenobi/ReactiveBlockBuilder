import assert from 'node:assert/strict';

export async function testDropdowns(page) {
	await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
	const theme = page.getByRole('combobox', { name: 'Theme stylesheet' });
	const menu = page.getByRole('listbox', { name: 'Theme stylesheet' });
	const saveBehavior = page.getByRole('combobox', { name: 'After saving a custom block' });
	await theme.click();
	assert.equal(await theme.getAttribute('aria-expanded'), 'true');
	await theme.click();
	assert.equal(await theme.getAttribute('aria-expanded'), 'false', 'Second click closes the menu');
	assert.equal(await menu.isVisible(), false);
	await theme.click();
	const heading = await page.locator('.theme-title strong').boundingBox();
	const trigger = await theme.boundingBox();
	assert(trigger.x > heading.x + heading.width, 'Selector is immediately after the title');
	assert(Math.abs(trigger.y + trigger.height / 2 - heading.y - heading.height / 2) < 2);
	const arrowInset = await theme.evaluate((element) => {
		return (
			element.getBoundingClientRect().right -
			element.querySelector('svg').getBoundingClientRect().right
		);
	});
	assert(arrowInset >= 12, 'Arrow has space before the right border');
	const anchored = async () => {
		await page.waitForFunction(() => {
			const control = document.querySelector('[role="combobox"][aria-label="Theme stylesheet"]');
			const menu = document.getElementById(control.getAttribute('aria-controls'));
			const a = control.getBoundingClientRect();
			const b = menu.getBoundingClientRect();
			return (
				Math.abs(a.x - b.x) < 2 &&
				(Math.abs(b.top - a.bottom - 4) < 2 || Math.abs(b.bottom - a.top + 4) < 2)
			);
		});
		const control = await theme.boundingBox();
		const popup = await menu.boundingBox();
		assert(Math.abs(control.x - popup.x) < 2, 'Menu aligns with its trigger');
		assert(
			Math.abs(popup.y - control.y - control.height - 4) < 2 ||
				Math.abs(popup.y + popup.height - control.y + 4) < 2,
			'Menu opens directly above or below its trigger'
		);
	};
	await anchored();
	assert.equal(
		await menu.evaluate((el) => getComputedStyle(el).backgroundColor),
		'rgb(255, 253, 248)'
	);
	assert.notEqual(await menu.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
	await page.getByRole('option', { name: 'Image', exact: true }).hover();
	assert.equal(
		await page
			.getByRole('option', { name: 'Image', exact: true })
			.evaluate((el) => getComputedStyle(el).backgroundColor),
		'rgb(238, 225, 204)'
	);
	await page.getByRole('option', { name: 'Image', exact: true }).click();
	assert.equal(await theme.innerText(), 'Image');
	assert.equal(
		await theme.getAttribute('aria-expanded'),
		'false',
		'Choosing an option closes the menu'
	);

	await theme.press('Home');
	await theme.press('End');
	await theme.press('ArrowUp');
	await theme.press('Enter');
	assert.equal(await theme.innerText(), 'Formula');
	await theme.press('t');
	await theme.press('e');
	await theme.press('Enter');
	assert.equal(await theme.innerText(), 'Text');
	await theme.press('ArrowDown');
	await theme.press('Escape');
	assert.equal(await theme.getAttribute('aria-expanded'), 'false', 'Escape closes the menu');
	assert.equal(await theme.innerText(), 'Text');
	await theme.click();
	await theme.press('Tab');
	assert.equal(await theme.getAttribute('aria-expanded'), 'false', 'Tab closes the menu');
	await theme.click();
	await page.locator('.topbar h1').click();
	assert.equal(
		await theme.getAttribute('aria-expanded'),
		'false',
		'Clicking elsewhere closes the menu'
	);

	// Both controls use the same styled menu and retain their selected values.
	await saveBehavior.click();
	await page.getByRole('option', { name: 'Keep original unchanged', exact: true }).click();
	assert.equal(await saveBehavior.innerText(), 'Keep original unchanged');
	await page.getByRole('button', { name: '▶ Play', exact: true }).click();
	await page.getByRole('button', { name: '✎ Design', exact: true }).click();
	assert.equal(await saveBehavior.innerText(), 'Keep original unchanged');
	for (const width of [900, 600]) {
		await page.setViewportSize({ width, height: 900 });
		await theme.click();
		await anchored();
		await theme.press('Escape');
	}
	console.log(
		'Shared dropdown alignment, styling, keyboard controls, dismissal and responsive layout passed'
	);
}
