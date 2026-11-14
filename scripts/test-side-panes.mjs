import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
	for (const width of [1440, 1001, 1000, 900, 621, 620, 600]) {
		const page = await browser.newPage({ viewport: { width, height: 700 } });
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });
		await page.locator('.sheet-title').first().waitFor({ state: 'visible' });

		const left = page.locator('.side-pane').first();
		const right = page.locator('.side-pane.right');
		const main = page.locator('.main-pane');
		const canvas = page.locator('.sheet-frame');
		const compact = width <= 1000;
		async function openInspector() {
			await page.locator('.sheet-title').first().click({ button: 'right' });
			const menu = page.getByRole('menu', { name: 'Block actions' });
			assert.equal(await menu.getByRole('separator').count(), 1);
			await menu.getByRole('menuitem', { name: 'View properties', exact: true }).click();
			await page.waitForTimeout(550);
			assert.equal(await right.isVisible(), true, 'Context menu opens properties at every width');
			assert.equal(
				await page.locator('#inspector-pane .selection-heading strong').innerText(),
				'textBlock'
			);
			if (compact) {
				const bounds = await right.boundingBox();
				assert.equal(bounds.y + bounds.height, 700, 'Properties drawer meets the viewport bottom');
			}
		}
		const initialWidth = (await canvas.boundingBox()).width;
		await page.getByLabel('New field identifier').fill('UNSAVED_DRAFT');
		await page.evaluate(() => {
			window.originalEditor = document.querySelector('.sheet-content .tiptap');
		});

		await openInspector();
		const initialMain = await main.boundingBox();
		await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
		await page.waitForTimeout(550);
		if (compact) {
			assert.equal(await right.isVisible(), false, 'Burger closes the drawer completely');
			assert.equal(
				await page.getByRole('button', { name: 'Show inspector', exact: true }).isVisible(),
				false
			);
		}
		if (width > 620) {
			const collapsedMain = await main.boundingBox();
			assert.equal(collapsedMain.x, initialMain.x, 'Center stays in its column');
			assert.equal(collapsedMain.y, initialMain.y, 'Center stays in the first row');
			assert(
				collapsedMain.width >= initialMain.width,
				'Collapsing inspector preserves center width'
			);
		}
		await openInspector();

		await page.getByRole('button', { name: 'Hide block palette', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(await page.locator('#block-palette-pane').getAttribute('inert'), '');
		assert.equal(
			await page
				.getByRole('button', { name: 'Show block palette', exact: true })
				.getAttribute('aria-expanded'),
			'false'
		);
		assert.equal(await page.locator('#inspector-pane aside').isVisible(), !compact);
		if (width > 620) assert.equal(Math.round((await left.boundingBox()).width), 0);
		if (width > 1000) assert((await canvas.boundingBox()).width > initialWidth + 150);

		if (compact) await openInspector();
		await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(await page.locator('#inspector-pane').getAttribute('inert'), '');
		assert.equal(
			await page.getByRole('button', { name: 'Show inspector', exact: true }).isVisible(),
			!compact
		);
		if (width > 620) {
			const layout = await page.locator('.editor-layout').boundingBox();
			const collapsedMain = await main.boundingBox();
			assert.equal(
				collapsedMain.x,
				layout.x,
				'Center starts at the left with both panes collapsed'
			);
			assert.equal(
				collapsedMain.y,
				layout.y,
				'Center stays in the first row with both panes collapsed'
			);
			assert.equal(collapsedMain.width, layout.width, 'Center fills the available width');
		}
		if (width > 1000) {
			assert.equal(Math.round((await right.boundingBox()).width), 0);
			assert.equal(
				Math.round((await canvas.boundingBox()).width),
				(await page.locator('.main-pane').evaluate((pane) => pane.clientWidth)) - 46,
				'Canvas uses both collapsed columns'
			);
		}
		if (compact) assert.equal(await right.isVisible(), false);
		if (width <= 620) assert.equal(Math.round((await left.boundingBox()).height), 0);
		const leftTab = await page
			.getByRole('button', { name: 'Show block palette', exact: true })
			.boundingBox();
		const availableWidth = await page.evaluate(() => document.documentElement.clientWidth);
		assert.equal(leftTab.x, 11.5);
		if (!compact) {
			const rightTab = await page
				.getByRole('button', { name: 'Show inspector', exact: true })
				.boundingBox();
			assert.equal(rightTab.x + rightTab.width, availableWidth - 11.5);
		}
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), availableWidth);
		if (width > 1000) {
			const toolbarTop = (await page.locator('.topbar').boundingBox()).height;
			await page.locator('.main-pane').evaluate((pane) => pane.scrollTo(0, 220));
			for (const toolbar of await page.locator('.pane-toolbar').all()) {
				assert.equal(
					Math.round((await toolbar.boundingBox()).y),
					Math.round(toolbarTop),
					'Collapsed tabs stay below the topbar while the center scrolls'
				);
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

		await page.getByRole('button', { name: '✎ Design', exact: true }).click();
		await page.waitForTimeout(550);
		assert.equal(
			await page.getByRole('button', { name: 'Hide block palette', exact: true }).isVisible(),
			true
		);
		assert.equal(
			await page.getByRole('button', { name: 'Show inspector', exact: true }).isVisible(),
			!compact
		);
		assert.equal(await page.getByLabel('New field identifier').inputValue(), 'UNSAVED_DRAFT');

		await openInspector();
		await page.locator('.topbar h1').click();
		await page.waitForTimeout(550);
		assert.equal(
			await right.isVisible(),
			!compact,
			'Outside clicks dismiss only the compact drawer'
		);
		assert.equal(
			await page.evaluate(
				() => window.originalEditor === document.querySelector('.sheet-content .tiptap')
			),
			true
		);
		if (width > 1000) {
			const toolbarTop = (await page.locator('.topbar').boundingBox()).height;
			await page.locator('.main-pane').evaluate((pane) => pane.scrollTo(0, 220));
			for (const toolbar of await page.locator('.pane-toolbar').all()) {
				assert.equal(
					Math.round((await toolbar.boundingBox()).y),
					Math.round(toolbarTop),
					'Burger stays below the topbar while the center scrolls'
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
