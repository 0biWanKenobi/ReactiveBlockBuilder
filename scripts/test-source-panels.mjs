/** Run through the embedded browser MCP on port 7345, with the app on 5173. */
export async function testSourcePanels(page) {
	const check = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const panel = page.locator('.source-panel');
	const code = async (value) =>
		panel.locator('.cm-content').evaluate(async (element, value) => {
			const url = performance
				.getEntriesByType('resource')
				.map((entry) => entry.name)
				.find((name) => name.includes('/codemirror.js'));
			const { EditorView } = await import(url);
			const view = EditorView.findFromDOM(element);
			if (value !== undefined) {
				view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
			}
			return view.state.doc.toString();
		}, value);
	const select = async (name) => {
		await page.getByRole('button', { name: '{ } Definition', exact: true }).click();
		await page.getByRole('menuitem', { name, exact: true }).click();
		await panel.locator('.cm-content').waitFor();
	};

	await page.goto('http://localhost:5173/');
	await page.getByRole('button', { name: '{ } Definition', exact: true }).click();
	check((await panel.locator('.cm-content').count()) === 0, 'Null selection starts empty');
	await page.getByRole('menuitem', { name: 'Sheet', exact: true }).click();
	await panel.locator('.cm-content').waitFor();
	const document = JSON.parse(await code());
	check(document.document.type === 'doc', 'Sheet selection loads document JSON');
	check(
		await panel.getByText('Sheet Definition', { exact: true }).isVisible(),
		'Sheet title updates'
	);
	const sheetDraft = JSON.stringify({ ...document, regressionDraft: true });
	await code(sheetDraft);
	await page.getByRole('button', { name: 'Format Definition', exact: true }).click();
	check((await code()) === JSON.stringify(JSON.parse(sheetDraft), null, 2) + '\n', 'Sheet formats');

	await select('Formulas');
	const formulas = JSON.parse(await code());
	check(!('document' in formulas), 'Formulas selection replaces document JSON');
	check(
		Object.values(formulas).every((field) => typeof field.formula === 'string'),
		'Formulas load'
	);
	check(
		await panel.getByText('Formula Definitions', { exact: true }).isVisible(),
		'Formula title updates'
	);
	const formulaDraft = JSON.stringify({ ...formulas, SOURCE_PANEL_TEST: { formula: '42' } });
	await code(formulaDraft);
	await page.getByRole('button', { name: 'Format Definition', exact: true }).click();
	check(
		(await code()) === JSON.stringify(JSON.parse(formulaDraft), null, 2) + '\n',
		'Formulas format'
	);

	await select('Sheet');
	check(JSON.parse(await code()).regressionDraft === true, 'Sheet draft survives switching');
	await select('Formulas');
	check(
		JSON.parse(await code()).SOURCE_PANEL_TEST.formula === '42',
		'Formula draft survives switching'
	);
	await page.getByRole('button', { name: '🖌️ Style', exact: true }).click();
	check(
		(await panel.getByText('Formula Definitions', { exact: true }).count()) === 0,
		'Style replaces JSON'
	);
	await select('Sheet');
	await panel.getByRole('button', { name: 'Sync from Preview', exact: true }).click();
	check(!('regressionDraft' in JSON.parse(await code())), 'Sync updates displayed source');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.waitForFunction(() =>
		document.querySelector('.slide-up').classList.contains('collapsed')
	);
}
