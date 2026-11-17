/** Embedded browser MCP; generate static/smoke-ball-bench.json with bundle.mjs first. */
export async function loadSmokeBall(page) {
	await page.evaluate(async () => {
		const bundle = await (await fetch('/smoke-ball-bench.json')).json();
		if (!sessionStorage.getItem('smokeOriginalStorage')) {
			sessionStorage.setItem(
				'smokeOriginalStorage',
				JSON.stringify(Object.fromEntries(Object.entries(localStorage)))
			);
		}
		for (const key of Object.keys(localStorage))
			if (key.startsWith('rbb:')) localStorage.removeItem(key);
		for (const [key, value] of Object.entries(bundle.storage)) localStorage.setItem(key, value);
	});
	await page.reload();
	await page.waitForFunction(
		() => {
			const tab = [...document.querySelectorAll('button')].find(
				(b) => b.textContent === '{ } Definition'
			);
			if (!tab || !document.querySelector('[aria-label="Edit New Note"]')) return false;
			if (tab.getAttribute('aria-pressed') !== 'true') {
				tab.click();
				return false;
			}
			return !!document.querySelector('.source-panel .cm-content');
		},
		null,
		{ polling: 20 }
	);
	await page.locator('.source-panel .cm-content').evaluate(async (el) => {
		const bundle = await (await fetch('/smoke-ball-bench.json')).json();
		const view = el.cmTile.root.view;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: JSON.stringify(bundle.sheet) }
		});
		document.querySelector('#apply-sheet-json').click();
	});
	await page.getByRole('button', { name: '📝 Sheet', exact: true }).evaluate((el) => el.click());
	return page.evaluate(() => ({
		pages: [...document.querySelectorAll('.main-pane .sb-page-title')].map((el) => el.textContent),
		formulaErrors: [...document.querySelectorAll('.main-pane .rbb-formula-error')].map(
			(el) => el.textContent
		),
		definitions: document.querySelectorAll('[aria-label^="Edit "]').length
	}));
}
