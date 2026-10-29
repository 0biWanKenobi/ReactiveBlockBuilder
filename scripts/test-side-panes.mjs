import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
	for (const width of [1440, 900, 600]) {
		const page = await browser.newPage({ viewport: { width, height: 700 } });
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });
		await page.locator('.sheet-title').first().waitFor({ state: 'visible' });

		const left = page.locator('.side-pane').first();
		const right = page.locator('.side-pane.right');
		const canvas = page.locator('.sheet-frame');
		const initialWidth = (await canvas.boundingBox()).width;
		await page.getByLabel('New field identifier').fill('UNSAVED_DRAFT');
		await page.evaluate(() => {
			window.originalEditor = document.querySelector('.sheet-content .tiptap');
		});

		await page.getByRole('button', { name: 'Hide block palette', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(await page.locator('#block-palette-pane').getAttribute('inert'), '');
		assert.equal(
			await page
				.getByRole('button', { name: 'Show block palette', exact: true })
				.getAttribute('aria-expanded'),
			'false'
		);
		assert.equal(await page.locator('#inspector-pane aside').isVisible(), true);
		if (width > 620) assert.equal(Math.round((await left.boundingBox()).width), 0);
		if (width > 1000) assert((await canvas.boundingBox()).width > initialWidth + 150);

		await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(await page.locator('#inspector-pane').getAttribute('inert'), '');
		assert.equal(
			await page.getByRole('button', { name: 'Show inspector', exact: true }).isVisible(),
			true
		);
		if (width > 1000) {
			assert.equal(Math.round((await right.boundingBox()).width), 0);
			assert.equal(
				Math.round((await canvas.boundingBox()).width),
				width - 46,
				'Canvas uses both collapsed columns'
			);
		}
		if (width <= 1000) assert.equal(Math.round((await right.boundingBox()).height), 0);
		if (width <= 620) assert.equal(Math.round((await left.boundingBox()).height), 0);
		const leftTab = await page
			.getByRole('button', { name: 'Show block palette', exact: true })
			.boundingBox();
		const rightTab = await page
			.getByRole('button', { name: 'Show inspector', exact: true })
			.boundingBox();
		assert.equal(leftTab.x, 11.5);
		assert.equal(rightTab.x + rightTab.width, width - 11.5);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
		if (width > 1000) {
			await page.evaluate(() => window.scrollTo(0, 220));
			for (const toolbar of await page.locator('.pane-toolbar').all()) {
				assert.equal(Math.round((await toolbar.boundingBox()).y), 0, 'Collapsed tabs stay sticky');
			}
		}

		await page.getByRole('button', { name: 'Show block palette', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(await page.getByLabel('New field identifier').inputValue(), 'UNSAVED_DRAFT');
		assert.equal(await page.locator('#block-palette-pane').getAttribute('inert'), null);
		assert.equal(await page.locator('#inspector-pane').getAttribute('inert'), '');

		await page.getByRole('button', { name: '▶ Play', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(await left.isVisible(), false);
		assert.equal(await right.isVisible(), false);
		if (width <= 1000) assert.equal((await right.boundingBox()).height, 0);

		await page.getByRole('button', { name: '✎ Design', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(
			await page.getByRole('button', { name: 'Hide block palette', exact: true }).isVisible(),
			true
		);
		assert.equal(
			await page.getByRole('button', { name: 'Show inspector', exact: true }).isVisible(),
			true
		);
		assert.equal(await page.getByLabel('New field identifier').inputValue(), 'UNSAVED_DRAFT');

		await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(
			await page.evaluate(
				() => window.originalEditor === document.querySelector('.sheet-content .tiptap')
			),
			true
		);
		if (width > 1000) {
			await page.evaluate(() => window.scrollTo(0, 220));
			for (const toolbar of await page.locator('.pane-toolbar').all()) {
				assert.equal(
					Math.round((await toolbar.boundingBox()).y),
					0,
					'Burger stays at the top while scrolling'
				);
			}
		}
		assert.deepEqual(errors, []);
		console.log(`Independent pane collapse, restoration, and Play mode passed at ${width}px`);
		await page.close();
	}
} finally {
	await browser.close();
}
