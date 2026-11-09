/** Run through the embedded browser MCP on port 7345, with the app on 5173. */
export async function testExpandedNodes(page) {
	const check = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const childId = 'expanded-regression-child';
	const parentId = 'expanded-regression-parent';
	const canvas = page.locator('.main-pane .sheet-document');
	const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
	const read = () => canvas.evaluate((el) => el.editor.getJSON());
	const text = (nodeId, value, className = nodeId) => ({
		type: 'textBlock',
		attrs: { nodeId, class: className },
		content: [{ type: 'text', text: value }]
	});
	const getCode = (source) =>
		source.evaluate(async (element) => {
			const url = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes('/codemirror.js'));
			const { EditorView } = await import(url);
			return EditorView.findFromDOM(element).state.doc.toString();
		});

	const setCode = async (source, value) =>
		source.evaluate(
			async (element, text) => {
				const url = performance
					.getEntriesByType('resource')
					.map((e) => e.name)
					.find((n) => n.includes('/codemirror.js'));
				const { EditorView } = await import(url);
				const view = EditorView.findFromDOM(element);
				view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
			},
			typeof value === 'string' ? value : JSON.stringify(value)
		);
	const editDefinition = async (name, transform) => {
		await page
			.getByRole('button', { name: 'Edit ' + name, exact: true })
			.evaluate((el) => el.click());
		const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
		const source = modal.getByRole('textbox', { name: 'Custom block structure JSON', exact: true });
		const structure = await source.evaluate(async (element) => {
			const url = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes('/codemirror.js'));
			const { EditorView } = await import(url);
			return JSON.parse(EditorView.findFromDOM(element).state.doc.toString());
		});
		await setCode(source, transform(structure));
		await modal
			.getByRole('button', { name: 'Apply JSON', exact: true })
			.evaluate((el) => el.click());
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		await modal.waitFor({ state: 'hidden' });
	};
	const select = (nodeId, occurrence = 0, caret = false) =>
		canvas.evaluate(
			(el, args) => {
				let count = 0,
					found;
				el.editor.state.doc.descendants((node, pos) => {
					if (node.attrs.nodeId === args.nodeId && count++ === args.occurrence) found = pos;
				});
				if (found === undefined) throw new Error('Missing slot: ' + args.nodeId);
				if (args.caret) {
					el.editor.commands.setTextSelection(found + 2);
					el.editor.view.focus();
				} else el.editor.commands.setNodeSelection(found);
				return found;
			},
			{ nodeId, occurrence, caret }
		);
	try {
		// Conversion keeps original values even when the new definition is reset.
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
							attrs: { class: 'expanded-conversion-regression' },
							content: [
								{
									type: 'textBlock',
									attrs: { class: 'conversion-label' },
									content: [{ type: 'text', text: 'Original conversion value' }]
								}
							]
						}
					]
				})
				.run()
		);
		await canvas
			.locator('.expanded-conversion-regression')
			.dispatchEvent('contextmenu', { button: 2 });
		await page
			.getByRole('button', { name: 'Save as custom block', exact: true })
			.evaluate((el) => el.click());
		let modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
		await modal.getByLabel('Custom block name').fill('Expanded Conversion');
		const draftSource = modal.getByRole('textbox', {
			name: 'Custom block structure JSON',
			exact: true
		});
		const draft = await getCode(draftSource);
		await setCode(draftSource, draft + ' ');
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		check(
			(await modal.getByRole('alert').innerText()).includes('Unapplied JSON changes'),
			'Definition save rejects unapplied JSON'
		);
		await modal
			.getByRole('button', { name: 'From preview', exact: true })
			.evaluate((el) => el.click());
		await modal
			.getByRole('button', { name: 'Reset values to defaults', exact: true })
			.evaluate((el) => el.click());
		check(
			(await modal.locator('.conversion-label').innerText()) === '...',
			'Definition reset changes its values'
		);
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		const confirmation = page.getByRole('dialog', { name: 'Saved custom block' });
		await confirmation
			.getByRole('button', { name: 'Replace original', exact: true })
			.evaluate((el) => el.click());
		check(
			(await canvas.locator('.conversion-label').innerText()) === 'Original conversion value',
			'Conversion retains original values after resetting definition'
		);
		check(
			(await read()).content[0].attrs.customNode === true,
			'Conversion produces an expanded flagged container'
		);
		const conversionBeforeBoundary = await read();
		await canvas.evaluate((el) => {
			const e = el.editor;
			e.view.dispatch(
				e.state.tr.insert(0, e.schema.node('textBlock', null, e.schema.text('Preceding text')))
			);
			const label = el.querySelector('.conversion-label');
			e.commands.setTextSelection(e.view.posAtDOM(label, 0));
			e.view.focus();
		});
		const beforeBoundaryKey = JSON.stringify(await read());
		await page.keyboard.press('Backspace');
		check(
			JSON.stringify(await read()) === beforeBoundaryKey,
			'Backspace cannot unwrap a custom instance into preceding text'
		);
		await canvas.evaluate((el) => {
			const e = el.editor;
			e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, e.state.doc.lastChild));
			const label = el.querySelector('.conversion-label');
			e.commands.setTextSelection(e.view.posAtDOM(label, 0));
			e.view.focus();
		});
		const beforeCopiedBoundary = JSON.stringify(await read());
		await page.keyboard.press('Backspace');
		check(
			JSON.stringify(await read()) === beforeCopiedBoundary,
			'Copied instances also resist boundary unwrapping'
		);
		await canvas.evaluate((el) => {
			const e = el.editor;
			const first = e.state.doc.firstChild.nodeSize;
			e.commands.setNodeSelection(first);
			e.commands.deleteSelection();
		});
		check(
			(await canvas.locator('[data-custom-node="true"]').count()) === 1,
			'One copied instance can be deleted without blocking the other'
		);

		await canvas.evaluate(
			(el, doc) =>
				el.editor
					.chain()
					.command(({ tr }) => {
						tr.setMeta('rbbCustomNodeSync', true);
						return true;
					})
					.setContent(doc)
					.run(),
			conversionBeforeBoundary
		);

		await page
			.getByRole('button', { name: 'Edit Expanded Conversion', exact: true })
			.evaluate((el) => el.click());
		modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
		const originalColor = await canvas
			.locator('.conversion-label')
			.evaluate((el) => getComputedStyle(el).color);
		await modal.getByRole('button', { name: 'CSS', exact: true }).evaluate((el) => el.click());
		await setCode(
			modal.getByRole('textbox', { name: 'Custom block CSS', exact: true }),
			'.conversion-label { color: rgb(1, 2, 3) !important; }'
		);
		check(
			(await canvas.locator('.conversion-label').evaluate((el) => getComputedStyle(el).color)) ===
				originalColor,
			'Draft CSS stays inside definition preview'
		);
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		await modal.waitFor({ state: 'hidden' });
		check(
			(await canvas.locator('.conversion-label').evaluate((el) => getComputedStyle(el).color)) ===
				'rgb(1, 2, 3)',
			'Saved CSS applies to expanded instances'
		);

		const child = {
			typeId: childId,
			name: 'Expanded Child',
			rootClass: '',
			structure: {
				type: 'container',
				attrs: { nodeId: 'child-root', class: 'expanded-child-root' },
				content: [text('child-text', 'Child value'), text('removed-child', 'Remove this')]
			}
		};
		const parent = {
			typeId: parentId,
			name: 'Expanded Parent',
			rootClass: 'expanded-extra',
			structure: {
				type: 'container',
				attrs: { nodeId: 'parent-root', class: 'expanded-parent-root' },
				content: [
					text('parent-text', 'Title'),
					{
						type: 'formula',
						attrs: { nodeId: 'parent-formula', class: 'expanded-formula', field: 'STR' }
					},
					{
						type: 'image',
						attrs: { nodeId: 'parent-image', class: 'expanded-image', src: '', alt: '' }
					}
				]
			}
		};
		await page.evaluate(
			async ({ child, parent }) => {
				const { makeInstance } = await import('/src/lib/custom-blocks/model.ts');
				const nested = makeInstance(child);
				nested.attrs.nodeId = 'child-slot';
				parent.structure.content.push(nested);
				for (const def of [child, parent])
					localStorage.setItem('rbb:custom-blocks/' + def.typeId + '.json', JSON.stringify(def));
			},
			{ child, parent }
		);
		await page.reload({ waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Edit Expanded Parent', exact: true }).waitFor();
		await canvas.evaluate(
			async (el, { childId, parentId }) => {
				const { makeInstance, prepareDocument } = await import('/src/lib/custom-blocks/model.ts');
				const definitions = [childId, parentId].map((id) =>
					JSON.parse(localStorage.getItem('rbb:custom-blocks/' + id + '.json'))
				);
				const library = {
					get: (id) => definitions.find((d) => d.typeId === id),
					clone: (id) => structuredClone(definitions.find((d) => d.typeId === id)),
					list: () => definitions
				};
				el.editor
					.chain()
					.command(({ tr }) => {
						tr.setMeta('rbbCustomNodeSync', true);
						return true;
					})
					.setContent(
						prepareDocument(
							{
								type: 'doc',
								content: [
									makeInstance(definitions[1]),
									makeInstance(definitions[1]),
									makeInstance(definitions[0])
								]
							},
							library
						)
					)
					.run();
			},
			{ childId, parentId }
		);
		let doc = await read();
		check(
			doc.content[0].type === 'container' && doc.content[0].attrs.customNode,
			'Live instances must be flagged stock containers'
		);
		check(doc.content[0].content[0].attrs.customNode === false, 'Stock children default to false');
		check(!JSON.stringify(doc).includes('"values":'), 'Live JSON must not contain override maps');
		check(
			(await canvas.locator('[data-custom-node="true"]').count()) === 5,
			'Two parent, two nested and one standalone instance'
		);
		check(
			(await canvas.locator('.expanded-parent-root').first().getAttribute('class')) ===
				'expanded-parent-root expanded-extra',
			'Root classes merge without an extra wrapper'
		);
		await select('parent-text', 0, true);
		await page.keyboard.insertText('X');
		check(
			(await read()).content[0].content[0].content[0].text === 'TXitle',
			'Native typing persists into expanded JSON'
		);
		check(
			(await page.getByLabel('Selected block CSS classes').count()) === 0,
			'Instance descendants cannot edit classes'
		);
		check(
			(await page.getByRole('button', { name: 'Delete selected block', exact: true }).count()) ===
				0,
			'Instance descendants cannot be individually deleted'
		);
		await select('parent-formula');
		await page.getByLabel('Selected formula field').fill('DEX');
		check(
			(await canvas.locator('.expanded-formula .rbb-formula').first().getAttribute('title')) ===
				'DEX',
			'Stock formula inspector updates custom descendants'
		);
		await select('parent-image');
		await page
			.getByLabel('Selected image URL')
			.fill('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');
		await page.getByLabel('Selected image description').fill('Edited portrait');
		check(
			(await canvas.locator('.expanded-image img').first().getAttribute('alt')) ===
				'Edited portrait',
			'Stock image inspector updates custom descendants'
		);
		await select('child-text', 0, true);
		await page.keyboard.insertText('X');
		const beforeProtection = JSON.stringify(await read());
		await canvas.evaluate((el) => {
			let pos;
			el.editor.state.doc.descendants((node, p) => {
				if (pos === undefined && node.attrs.nodeId === 'parent-text') pos = p;
			});
			const node = el.editor.state.doc.nodeAt(pos);
			el.editor.view.dispatch(el.editor.state.tr.delete(pos, pos + node.nodeSize));
			el.editor.view.dispatch(el.editor.state.tr.setNodeAttribute(pos, 'class', 'forbidden'));
			el.editor.view.dispatch(el.editor.state.tr.insert(pos, el.editor.schema.node('formula')));
		});
		check(
			JSON.stringify(await read()) === beforeProtection,
			'Structure protection rejects deletion, insertion and class edits'
		);
		await editDefinition('Expanded Child', (structure) => ({
			...structure,
			content: [
				text('child-text', 'Changed definition value'),
				text('added-child', 'Added child definition value')
			]
		}));
		check(
			(await canvas.locator('.removed-child').count()) === 0,
			'Definition deletions propagate to direct and nested instances'
		);
		check(
			(await canvas.locator('.added-child').allTextContents()).join('|') ===
				Array(3).fill('Added child definition value').join('|'),
			'Additions copy definition values into all instances'
		);
		check(
			(await canvas.locator('.child-text').allTextContents()).join('|') ===
				'CXhild value|Child value|Child value',
			'Edited and untouched surviving values remain unchanged'
		);
		const storedParent = await page.evaluate(
			(id) => JSON.parse(localStorage.getItem('rbb:custom-blocks/' + id + '.json')),
			parentId
		);
		check(
			!JSON.stringify(storedParent).includes('removed-child') &&
				JSON.stringify(storedParent).includes('added-child'),
			'Nested structure changes are persisted in dependent definitions'
		);
		await editDefinition('Expanded Parent', (structure) => ({
			...structure,
			content: [
				{
					type: 'container',
					attrs: { nodeId: 'new-layout', class: 'new-layout' },
					content: [structure.content[0]]
				},
				structure.content[2],
				structure.content[3],
				{
					type: 'formula',
					attrs: { nodeId: 'added-formula', class: 'added-formula', field: 'DEX_MOD' }
				},
				text('added-parent', 'Added parent definition value')
			]
		}));
		doc = await read();
		check(
			doc.content[0].content[0].content[0].content[0].text === 'TXitle',
			'Moving a slot between containers preserves its value'
		);
		check(
			(await canvas.locator('.expanded-formula').count()) === 0,
			'Removed edited formula disappears from both instances'
		);
		check(
			(await canvas.locator('.added-formula').count()) === 2,
			'New formulas appear in both instances'
		);
		check(
			doc.content[0].content[3].attrs.field === 'DEX_MOD',
			'Added formula copies definition field'
		);
		check(
			doc.content[0].content[1].attrs.alt === 'Edited portrait',
			'Surviving image edits persist'
		);
		check(
			(await canvas.locator('.added-parent').allTextContents()).join('|') ===
				'Added parent definition value|Added parent definition value',
			'New text copies definition value'
		);
		const html = await canvas.evaluate((el) => el.editor.getHTML());
		check(
			html.includes('Added child definition value') &&
				html.includes('TXitle') &&
				html.includes('data-custom-node="true"'),
			'HTML serialization includes expanded contents and flags'
		);
		await page.locator('#sync-sheet-json').evaluate((el) => el.click());

		// The actual editor label is the authoritative source, independent of layout.
		const sourceEditor = page.locator('.source-panel').first().locator('.cm-content');
		const exported = await sourceEditor.evaluate(async (el) => {
			const url = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes('/codemirror.js'));
			const { EditorView } = await import(url);
			return JSON.parse(EditorView.findFromDOM(el).state.doc.toString());
		});
		check(
			JSON.stringify(exported.document) === JSON.stringify(doc),
			'Sheet JSON equals the expanded editor document'
		);
		await page.locator('#apply-sheet-json').evaluate((el) => el.click());
		check(
			JSON.stringify(await read()) === JSON.stringify(doc),
			'Expanded JSON roundtrip preserves structure and values'
		);
		const invalid = JSON.parse(JSON.stringify(exported));
		invalid.document.content[0].attrs.typeId = 'missing-expanded-definition';
		await setCode(sourceEditor, invalid);
		await page.locator('#apply-sheet-json').evaluate((el) => el.click());
		check(
			(await page.getByRole('status').innerText()).includes('Missing custom block definition'),
			'Missing references fail import'
		);
		check(
			JSON.stringify(await read()) === JSON.stringify(doc),
			'Rejected import leaves the document intact'
		);
		const unsupported = JSON.parse(JSON.stringify(exported));
		unsupported.document.content[0] = {
			type: 'customBlock',
			attrs: { typeId: parentId, values: {} }
		};
		await setCode(sourceEditor, unsupported);
		await page.locator('#apply-sheet-json').evaluate((el) => el.click());
		check(
			(await page.getByRole('status').innerText()).includes('Unsupported node: customBlock'),
			'Compact JSON is rejected'
		);
		check(
			JSON.stringify(await read()) === JSON.stringify(doc),
			'Unsupported import leaves expanded document intact'
		);

		await page
			.getByRole('button', { name: 'Drag', exact: true })
			.evaluateAll((buttons) => buttons[0].click());
		check(
			(await canvas.getAttribute('contenteditable')) === 'false',
			'Drag mode disables native text editing'
		);
		check(
			(await canvas.locator('.expanded-parent-root').first().getAttribute('draggable')) === 'true',
			'Custom roots drag as blocks'
		);
		check(
			(await canvas.locator('.expanded-parent-root [draggable="true"]').count()) === 0,
			'Custom descendants are not drag targets'
		);
		await canvas
			.locator('.parent-text')
			.first()
			.dispatchEvent('mousemove', { clientX: 400, clientY: 400 });
		check(
			(await page.locator('.main-pane .rbb-block-drag-rail:not([hidden]) button').count()) === 1,
			'Nested hover exposes only the outer custom drag handle'
		);
		await canvas.locator('.parent-text').first().dispatchEvent('mousedown', { button: 0 });
		check(
			(await canvas.evaluate((el) => el.editor.state.selection.node?.attrs.typeId)) === parentId,
			'Drag click selects the enclosing custom instance'
		);

		await page
			.getByRole('button', { name: 'Edit', exact: true })
			.evaluateAll((buttons) => buttons[0].click());
		await page.getByRole('button', { name: '▶ Play', exact: true }).evaluate((el) => el.click());
		check((await canvas.getAttribute('contenteditable')) === 'false', 'Play mode disables editing');
		await page.getByRole('button', { name: '✎ Design', exact: true }).evaluate((el) => el.click());
		await page
			.getByRole('button', { name: 'Edit Expanded Parent', exact: true })
			.evaluate((el) => el.click());
		modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
		await modal.locator('.sheet-document').evaluate((el, childId) => {
			let position;
			el.editor.state.doc.descendants((node, pos) => {
				if (position === undefined && node.attrs.customNode && node.attrs.typeId === childId)
					position = pos;
			});
			el.editor.commands.setNodeSelection(position);
		}, childId);
		await modal
			.getByRole('button', { name: 'Edit definition', exact: true })
			.evaluate((el) => el.click());
		const cycleSource = modal.getByRole('textbox', {
			name: 'Custom block structure JSON',
			exact: true
		});
		const cycleStructure = JSON.parse(await getCode(cycleSource));
		cycleStructure.content.push({
			type: 'container',
			attrs: { customNode: true, typeId: childId, instanceId: 'self', nodeId: 'self' },
			content: [text('cycle-value', 'Cycle')]
		});
		await setCode(cycleSource, cycleStructure);
		await modal
			.getByRole('button', { name: 'Apply JSON', exact: true })
			.evaluate((el) => el.click());
		check(
			(await modal.getByRole('alert').innerText()).includes('Circular custom block reference'),
			'Definition JSON rejects cycles before reconciliation'
		);
		await modal
			.getByRole('button', { name: 'From preview', exact: true })
			.evaluate((el) => el.click());

		await modal.getByLabel('Custom block name').fill('Expanded Child Renamed');
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		await page
			.getByRole('button', { name: 'Back to parent definition', exact: true })
			.waitFor({ state: 'hidden' });
		check(
			(await modal.getByLabel('Custom block name').inputValue()) === 'Expanded Parent',
			'Saving a nested definition returns to parent draft'
		);
		await modal
			.getByRole('button', { name: 'Close editor', exact: true })
			.evaluate((el) => el.click());
		await modal.waitFor({ state: 'hidden' });

		await canvas.evaluate((el) => el.editor.commands.setNodeSelection(0));
		await page
			.getByRole('button', { name: 'Delete custom block', exact: true })
			.evaluate((el) => el.click());
		check((await read()).content.length === 2, 'Whole instances remain deletable');
		check(
			(await page.getByRole('button', { name: 'Edit Expanded Parent', exact: true }).count()) === 1,
			'Deleting an instance preserves its definition'
		);
		// Editing a nested definition while converting must map the captured source position.
		await canvas.evaluate(async (el, childId) => {
			const { makeInstance } = await import('/src/lib/custom-blocks/model.ts');
			const child = JSON.parse(localStorage.getItem('rbb:custom-blocks/' + childId + '.json'));
			el.editor
				.chain()
				.command(({ tr }) => {
					tr.setMeta('rbbCustomNodeSync', true);
					return true;
				})
				.setContent({
					type: 'doc',
					content: [
						makeInstance(child),
						{
							type: 'container',
							attrs: { class: 'expanded-conversion-shift' },
							content: [makeInstance(child)]
						}
					]
				})
				.run();
		}, childId);
		await canvas.locator('.expanded-conversion-shift').dispatchEvent('contextmenu', { button: 2 });
		await page
			.getByRole('button', { name: 'Save as custom block', exact: true })
			.evaluate((el) => el.click());
		modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
		await modal.locator('.sheet-document').evaluate((el) => el.editor.commands.setNodeSelection(1));
		await modal
			.getByRole('button', { name: 'Edit definition', exact: true })
			.evaluate((el) => el.click());
		const nestedSource = modal.getByRole('textbox', {
			name: 'Custom block structure JSON',
			exact: true
		});
		const shiftedStructure = JSON.parse(await getCode(nestedSource));
		shiftedStructure.content.push(text('shifted-new-child', 'Added during conversion'));
		await setCode(nestedSource, shiftedStructure);
		await modal
			.getByRole('button', { name: 'Apply JSON', exact: true })
			.evaluate((el) => el.click());
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		await page
			.getByRole('button', { name: 'Back to parent definition', exact: true })
			.waitFor({ state: 'hidden' });
		await modal
			.getByRole('button', { name: 'Save definition', exact: true })
			.evaluate((el) => el.click());
		await page
			.getByRole('dialog', { name: 'Saved custom block' })
			.getByRole('button', { name: 'Replace original', exact: true })
			.evaluate((el) => el.click());
		const shiftedDoc = await read();
		check(
			shiftedDoc.content[0].attrs.typeId === childId &&
				shiftedDoc.content[1].attrs.customNode &&
				shiftedDoc.content[1].attrs.typeId === 'expanded-conversion-shift',
			'Conversion still replaces the correct container after earlier instances grow'
		);
		check(
			(await canvas.locator('.expanded-conversion-shift .shifted-new-child').count()) === 1,
			'Converted instance includes the nested structural addition'
		);

		return 'Expanded JSON, native editing, inspectors, structural protection, direct/nested evolution, conversion, CSS isolation, definition navigation, HTML/JSON, modes and instance deletion passed';
	} finally {
		await page.evaluate((saved) => {
			for (const key of Object.keys(localStorage))
				if (!(key in saved)) localStorage.removeItem(key);
			for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
		}, saved);
		await page.reload({ waitUntil: 'networkidle' });
	}
}
