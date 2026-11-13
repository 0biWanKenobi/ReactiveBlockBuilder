/** Run through the embedded browser MCP on port 7345, with the app on 5173. */
export async function testFormulaLabel(page) {
	const check = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const canvas = page.locator('.main-pane .sheet-document');
	const source = page.getByRole('textbox', { name: 'Sheet JSON', exact: true });
	const original = await canvas.evaluate((element) => element.editor.getJSON());
	const code = (value) =>
		source.evaluate(async (element, next) => {
			const url = performance
				.getEntriesByType('resource')
				.map((entry) => entry.name)
				.find((name) => name.includes('/codemirror.js'));
			const { EditorView } = await import(url);
			const view = EditorView.findFromDOM(element);
			if (next !== undefined) {
				view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
			}
			return view.state.doc.toString();
		}, value);
	const originalSource = await code();
	const attrs = () => canvas.evaluate((element) => element.editor.state.doc.firstChild.attrs);
	const formula = canvas.locator('.rbb-formula');
	try {
		await canvas.evaluate((element) =>
			element.editor.commands.setContent({
				type: 'doc',
				content: [{ type: 'formula', attrs: { field: 'STR', showLabel: false } }]
			})
		);
		check((await attrs()).label === '', 'Formula label defaults to an empty string');
		await page.locator('#sync-sheet-json').evaluate((element) => element.click());
		const saved = JSON.parse(await code());
		saved.document.content[0].attrs.showLabel = true;
		saved.document.content[0].attrs.label = 'Strength';
		await code(JSON.stringify(saved));
		await page.locator('#apply-sheet-json').evaluate((element) => element.click());
		check((await attrs()).showLabel === true, 'JSON apply stores showLabel: true');
		check(
			(await formula.innerText()).replace(/\s/g, '') === 'Strength:16',
			`JSON apply must display Strength:16, got ${await formula.innerText()}`
		);

		await canvas.evaluate((element) => element.editor.commands.setNodeSelection(0));
		const label = page.getByRole('textbox', { name: 'Selected formula label', exact: true });
		check((await label.inputValue()) === 'Strength', 'Sidepane reflects imported label');
		await label.fill('Might');
		check((await attrs()).label === 'Might', 'Sidepane stores label edits');
		check(
			(await formula.innerText()).replace(/\s/g, '') === 'Might:16',
			'Sidepane label edits update preview'
		);
		const toggle = page.getByRole('checkbox', { name: 'Show Label', exact: true });
		const layout = await toggle.evaluate((element) => {
			const row = element.closest('label');
			const style = getComputedStyle(row);
			return {
				display: style.display,
				alignment: style.alignItems,
				spacing: style.justifyContent,
				width: element.getBoundingClientRect().width,
				background: getComputedStyle(element).backgroundColor
			};
		});
		check(
			layout.display === 'flex' &&
				layout.alignment === 'center' &&
				layout.spacing === 'space-between',
			'Checkbox aligns horizontally with Show Label'
		);
		check(
			layout.width === 18 && layout.background === 'rgb(221, 189, 140)',
			'Checkbox uses compact sizing and UI palette'
		);
		await toggle.uncheck();
		check((await attrs()).showLabel === false, 'Sidepane stores showLabel: false');
		check((await formula.innerText()).trim() === '16', 'Sidepane hides label without boolean text');
		await toggle.check();
		check((await attrs()).showLabel === true, 'Sidepane stores showLabel: true');
		check((await formula.innerText()).replace(/\s/g, '') === 'Might:16', 'Sidepane shows label');
		await label.fill('');
		check((await formula.innerText()).trim() === '16', 'Empty label displays no prefix');
		await label.fill('Might');
		await page.locator('#sync-sheet-json').evaluate((element) => element.click());
		check(
			JSON.parse(await code()).document.content[0].attrs.showLabel === true,
			'JSON export keeps label'
		);
		check(
			JSON.parse(await code()).document.content[0].attrs.label === 'Might',
			'JSON export keeps label'
		);
		saved.document.content[0].attrs.showLabel = false;
		await code(JSON.stringify(saved));
		await page.locator('#apply-sheet-json').evaluate((element) => element.click());
		check((await formula.innerText()).trim() === '16', 'JSON apply hides label again');
		return 'Formula showLabel: JSON apply, sidepane toggles and JSON export passed';
	} finally {
		await canvas.evaluate(
			(element, document) => element.editor.commands.setContent(document),
			original
		);
		await code(originalSource);
	}
}

export async function testCustomFormulaLabel(page) {
	const check = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const canvas = page.locator('.main-pane .sheet-document');
	const original = await canvas.evaluate((element) => element.editor.getJSON());
	const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
	const childId = 'formula-label-regression-child';
	const parentId = 'formula-label-regression-parent';
	try {
		await page.evaluate(
			async ({ childId, parentId }) => {
				const { createDefinition, makeInstance } = await import('/src/lib/custom-blocks/model.ts');
				const child = createDefinition(
					'Formula label regression child',
					{
						type: 'container',
						content: [
							{
								type: 'formula',
								attrs: {
									nodeId: 'formula',
									field: 'STR',
									label: 'Definition label',
									showLabel: false
								}
							}
						]
					},
					{ get: () => undefined, list: () => [] }
				);
				child.typeId = childId;
				const parent = createDefinition(
					'Formula label regression parent',
					{
						type: 'container',
						content: [makeInstance(child)]
					},
					{ get: (id) => (id === childId ? child : undefined), list: () => [child] }
				);
				parent.typeId = parentId;
				for (const definition of [child, parent]) {
					localStorage.setItem(
						'rbb:custom-blocks/' + definition.typeId + '.json',
						JSON.stringify(definition)
					);
				}
			},
			{ childId, parentId }
		);
		await page.reload({ waitUntil: 'networkidle' });
		await page
			.getByRole('button', { name: 'Edit Formula label regression parent', exact: true })
			.waitFor();
		for (const [typeId, position] of [
			[childId, 1],
			[parentId, 2]
		]) {
			await canvas.evaluate(async (element, typeId) => {
				const { makeInstance } = await import('/src/lib/custom-blocks/model.ts');
				const definition = JSON.parse(
					localStorage.getItem('rbb:custom-blocks/' + typeId + '.json')
				);
				element.editor
					.chain()
					.command(({ tr }) => {
						tr.setMeta('rbbCustomNodeSync', true);
						return true;
					})
					.setContent({ type: 'doc', content: [makeInstance(definition)] })
					.run();
			}, typeId);
			await canvas.evaluate(
				(element, position) => element.editor.commands.setNodeSelection(position),
				position
			);
			const label = page.getByRole('textbox', { name: 'Selected formula label', exact: true });
			await label.fill('Might');
			const toggle = page.getByRole('checkbox', { name: 'Show Label', exact: true });
			const formula = canvas.locator('.rbb-formula');
			for (const showLabel of [true, false]) {
				await toggle.evaluate((element) => element.click());
				check(
					(await canvas.evaluate(
						(element, position) => element.editor.state.doc.nodeAt(position).attrs.showLabel,
						position
					)) === showLabel,
					`${typeId}: sidepane must store showLabel: ${showLabel}`
				);
				check(
					(await formula.innerText()).replace(/\s/g, '') === (showLabel ? 'Might:16' : '16'),
					`${typeId}: preview must reflect showLabel: ${showLabel}`
				);
				await page.locator('#sync-sheet-json').evaluate((element) => element.click());
				await page.locator('#apply-sheet-json').evaluate((element) => element.click());
				check(
					(await formula.innerText()).replace(/\s/g, '') === (showLabel ? 'Might:16' : '16'),
					`${typeId}: JSON roundtrip must preserve showLabel: ${showLabel}`
				);
				await canvas.evaluate(
					(element, position) => element.editor.commands.setNodeSelection(position),
					position
				);
				check(
					(await label.inputValue()) === 'Might',
					`${typeId}: JSON roundtrip keeps edited label`
				);
			}
		}
		return 'Direct and nested custom formula label edits and toggles and JSON roundtrips passed';
	} finally {
		await page.evaluate((storage) => {
			for (const key of Object.keys(localStorage))
				if (!(key in storage)) localStorage.removeItem(key);
			for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
		}, storage);
		await page.reload({ waitUntil: 'networkidle' });
		await canvas.evaluate(
			(element, document) =>
				element.editor
					.chain()
					.command(({ tr }) => {
						tr.setMeta('rbbCustomNodeSync', true);
						return true;
					})
					.setContent(document)
					.run(),
			original
		);
	}
}
