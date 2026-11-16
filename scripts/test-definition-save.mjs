/** Run through the embedded browser MCP on port 7345, with the app on 5173. */
export async function testDefinitionSave(page) {
	const check = (ok, message) => {
		if (!ok) throw new Error(message);
	};
	const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
	const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
	const canvas = page.locator('.main-pane .sheet-document');
	const click = (locator) => locator.evaluate((el) => el.click());
	const button = (name) => modal.getByRole('button', { name, exact: true });
	const preview = () => modal.locator('.preview .sheet-document');
	const code = (value) =>
		modal.locator('.cm-content').evaluate(async (el, value) => {
			const url = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes('/codemirror.js'));
			const { EditorView } = await import(url);
			const view = EditorView.findFromDOM(el);
			if (value === undefined) return JSON.parse(view.state.doc.toString());
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
		}, value);
	const open = async (name) => {
		await click(page.getByRole('button', { name: 'Edit ' + name, exact: true }));
		await preview().waitFor();
	};
	const nested = async () => {
		await preview().evaluate((el) => {
			let pos;
			el.editor.state.doc.descendants((node, p) => {
				if (node.attrs.customNode && pos === undefined) pos = p;
			});
			el.editor.commands.setNodeSelection(pos);
		});
		await click(button('Edit definition'));
		await page.waitForFunction(
			() => document.querySelector('[aria-label="Custom block name"]').value === 'Save Child'
		);
	};
	const save = async (sync, returnsToParent = false) => {
		const name = await modal.getByLabel('Custom block name').inputValue();
		await page.evaluate(() => {
			globalThis.saveCounts = { clones: 0, reads: 0 };
		});
		await click(button('Save definition'));
		if (returnsToParent) {
			await page.waitForFunction(
				() => document.querySelector('[aria-label="Custom block name"]').value === 'Save Parent'
			);
		} else await modal.waitFor({ state: 'hidden' });
		const counts = await page.evaluate(() => globalThis.saveCounts);
		console.log('Saved', name, 'sync expected:', sync, counts);
		check(
			sync ? counts.clones > 0 : counts.clones === 0,
			`${name}: expected sync=${sync}, got ${JSON.stringify(counts)}`
		);
		check(counts.reads === 0, 'Save must not reread block CSS');
	};
	const installProbe = () =>
		page.evaluate(async () => {
			const url = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes('/custom-blocks/library.svelte.ts'));
			const { CustomBlockLibrary } = await import(url);
			const originalClone = CustomBlockLibrary.prototype.clone;
			const originalRead = Storage.prototype.getItem;
			globalThis.saveCounts = { clones: 0, reads: 0 };
			CustomBlockLibrary.prototype.clone = function (...args) {
				globalThis.saveCounts.clones++;
				return originalClone.apply(this, args);
			};
			Storage.prototype.getItem = function (key) {
				if (key.startsWith('rbb:themes/default/blocks/')) globalThis.saveCounts.reads++;
				return originalRead.call(this, key);
			};
			globalThis.restoreSaveProbe = () => {
				CustomBlockLibrary.prototype.clone = originalClone;
				Storage.prototype.getItem = originalRead;
				delete globalThis.saveCounts;
				delete globalThis.restoreSaveProbe;
			};
		});
	try {
		await page.evaluate(async () => {
			const { createDefinition, makeInstance } = await import('/src/lib/custom-blocks/model.ts');
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith('rbb:custom-blocks/') || key.startsWith('rbb:themes/default/blocks/'))
					localStorage.removeItem(key);
			}
			const library = {
				list: () => definitions,
				get: (id) => definitions.find((d) => d.typeId === id)
			};
			const definitions = [];
			const child = createDefinition(
				'Save Child',
				{
					type: 'container',
					content: [
						{
							type: 'textBlock',
							attrs: { class: 'save-text' },
							content: [{ type: 'text', text: 'Default' }]
						}
					]
				},
				library
			);
			child.typeId = 'save-child';
			definitions.push(child);
			const parent = createDefinition(
				'Save Parent',
				{ type: 'container', content: [makeInstance(child)] },
				library
			);
			parent.typeId = 'save-parent';
			definitions.push(parent);
			for (const definition of definitions) {
				localStorage.setItem(
					'rbb:custom-blocks/' + definition.typeId + '.json',
					JSON.stringify(definition)
				);
				localStorage.setItem(
					'rbb:themes/default/blocks/' + definition.typeId + '.css',
					'.save-text { color: ' + (definition === child ? 'red' : 'blue') + '; }'
				);
			}
		});
		await page.reload();
		await page.getByRole('button', { name: 'Edit Save Parent', exact: true }).waitFor();
		await installProbe();
		await canvas.evaluate(async (el) => {
			const { makeInstance, prepareDocument } = await import('/src/lib/custom-blocks/model.ts');
			const definitions = ['save-child', 'save-parent'].map((id) =>
				JSON.parse(localStorage.getItem('rbb:custom-blocks/' + id + '.json'))
			);
			const library = {
				list: () => definitions,
				get: (id) => definitions.find((d) => d.typeId === id)
			};
			const doc = prepareDocument(
				{ type: 'doc', content: [makeInstance(definitions[1])] },
				library
			);
			doc.content[0].content[0].content[0].content[0].text = 'Entered value';
			el.editor
				.chain()
				.command(({ tr }) => {
					tr.setMeta('rbbCustomNodeSync', true);
					return true;
				})
				.setContent(doc)
				.run();
		});

		// Metadata/CSS saves skip reconciliation but retain cascade changes from upsert.
		await open('Save Child');
		await modal.getByLabel('Custom block name').fill('Renamed Child');
		await save(false);
		await open('Renamed Child');
		await modal.getByLabel('Custom block name').fill('Save Child');
		await code('.save-text { color: rgb(12, 34, 56); }');
		await save(false);
		check(
			await canvas
				.locator('.save-text')
				.evaluate((el) => getComputedStyle(el).color === 'rgb(12, 34, 56)'),
			'Saved CSS must apply immediately in library order'
		);

		await open('Save Child');
		await modal.getByLabel('Root CSS class').fill('save-root');
		await save(true);
		check(
			(await canvas.locator('.save-root').count()) === 1,
			'Root class must reach nested live instances'
		);

		await open('Save Child');
		await click(button('Structure'));
		const structure = await code();
		structure.content.push({
			type: 'textBlock',
			attrs: { class: 'save-added' },
			content: [{ type: 'text', text: 'Added' }]
		});
		await code(JSON.stringify(structure));
		await click(button('Save definition'));
		check(
			(await modal.getByRole('alert').innerText()).includes('Unapplied JSON'),
			'Unapplied JSON must still block saving'
		);
		await click(button('Apply JSON'));
		await save(true);
		check(
			(await canvas.locator('.save-added').innerText()) === 'Added',
			'JSON changes must propagate'
		);
		check(
			(await canvas.locator('.save-text').innerText()) === 'Entered value',
			'Propagation must preserve instance values'
		);
		check(
			await page.evaluate(() =>
				localStorage.getItem('rbb:custom-blocks/save-parent.json').includes('save-added')
			),
			'Nested changes must persist in parent definition'
		);

		// Preview edits survive navigation and saving/closing a child modal.
		for (const saveChild of [false, true]) {
			await open('Save Parent');
			await preview().evaluate((el, suffix) => {
				el.editor.view.dispatch(
					el.editor.state.tr.setNodeAttribute(0, 'class', 'save-parent-layout-' + suffix)
				);
			}, String(saveChild));
			await nested();
			if (saveChild) await save(false, true);
			else await click(button('Back to parent definition'));
			await save(true);
		}
		// Clean parent navigation must not accidentally acquire the sync hint.
		await open('Save Parent');
		await nested();
		await click(button('Back to parent definition'));
		await save(false);

		await open('Save Child');
		await click(button('Structure'));
		await click(button('Reset values to defaults'));
		await save(true);

		// A reverted preview edit remains a conservative sync hint, not a dirty flag.
		const editAndRevert = () =>
			preview().evaluate((el) => {
				const editor = el.editor;
				const previous = editor.state.doc.firstChild.attrs.class;
				editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'class', 'temporary'));
				editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'class', previous));
			});
		await open('Save Child');
		await editAndRevert();
		await save(true);
		await open('Save Child');
		await editAndRevert();
		await click(button('Close editor'));
		await modal.waitFor({ state: 'hidden' });

		// New definitions must synchronize even if their preview was never edited.
		await canvas.evaluate((el) =>
			el.editor
				.chain()
				.command(({ tr }) => {
					tr.setMeta('rbbCustomNodeSync', true);
					return true;
				})
				.setContent({
					type: 'doc',
					content: [
						{
							type: 'container',
							attrs: { class: 'save-new' },
							content: [{ type: 'textBlock', content: [{ type: 'text', text: 'New definition' }] }]
						}
					]
				})
				.run()
		);
		await canvas.locator('.save-new').dispatchEvent('contextmenu', { button: 2 });
		await click(page.getByRole('menuitem', { name: 'Save as custom block', exact: true }));
		await save(true);
		await click(
			page
				.getByRole('dialog', { name: 'Saved custom block' })
				.getByRole('button', { name: 'Keep original', exact: true })
		);
		console.log(
			'Definition save: metadata/CSS gating, CSS ordering, root class, JSON, preview, nested navigation, reset, reverted edits and creation passed'
		);
	} finally {
		await page.evaluate((saved) => {
			globalThis.restoreSaveProbe?.();
			localStorage.clear();
			for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
		}, saved);
		await page.reload();
	}
}
