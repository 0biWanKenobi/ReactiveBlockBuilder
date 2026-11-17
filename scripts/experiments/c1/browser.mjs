/** Embedded-browser MCP only. Production snapshots served on 5174/5175. */
export async function benchmarkC1Browser(page, rounds = 1, startRound = 0, allocations = false) {
	const results = [];
	const scenarios = [
		{ id: 'sb-property', name: 'Property row', kind: 'shared-property' },
		{ id: 'sb-template-1', name: 'New Note', kind: 'journal-note' },
		{ id: 'sb-template-2', name: 'New Feature', kind: 'trait-note' },
		{ id: 'sb-template-1', name: 'New Note', kind: 'note-layout-add', add: true }
	];
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
	await cdp.send('Performance.enable');
	const metrics = async () =>
		Object.fromEntries(
			(await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])
		);
	const original = {};
	try {
		for (let round = startRound; round < startRound + rounds; round++) {
			const variants = round % 2 ? ['after', 'before'] : ['before', 'after'];
			for (const scenario of scenarios)
				for (const variant of variants) {
					const origin = `http://localhost:${variant === 'before' ? 5174 : 5175}`;
					await page.goto(origin);
					if (!(origin in original))
						original[origin] = await page.evaluate(() =>
							Object.fromEntries(Object.entries(localStorage))
						);
					await page.evaluate(async () => {
						const bundle = await (await fetch('/smoke-ball-bench.json')).json();
						for (const key of Object.keys(localStorage))
							if (key.startsWith('rbb:')) localStorage.removeItem(key);
						for (const [key, value] of Object.entries(bundle.storage))
							localStorage.setItem(key, value);
					});
					// Fresh JS realm and empty HTTP cache for every sample; no save warmups.
					await page.goto('about:blank');
					await cdp.send('Network.clearBrowserCache');
					await page.goto(origin);
					await page.waitForFunction(
						() => {
							const tab = [...document.querySelectorAll('button')].find(
								(b) => b.textContent === '{ } Definition'
							);
							if (!tab || document.querySelectorAll('[aria-label^="Edit New Note"]').length !== 1)
								return false;
							if (tab.getAttribute('aria-pressed') !== 'true') {
								tab.click();
								return false;
							}
							return !!document.querySelector('.source-panel .cm-content');
						},
						null,
						{ polling: 20 }
					);
					const startup = await page.evaluate(() => performance.now());
					// Use the existing import flow; the application does not persist the sheet.
					await page.evaluate(async () => {
						const bundle = await (await fetch('/smoke-ball-bench.json')).json();
						const source = document.querySelector('.source-panel .cm-content');
						// Production bundles do not export EditorView. This is the installed
						// CodeMirror version's findFromDOM path, used only by this test harness.
						const view = source.cmTile.root.view;
						view.dispatch({
							changes: { from: 0, to: view.state.doc.length, insert: JSON.stringify(bundle.sheet) }
						});
						globalThis.smokeImportStarted = performance.now();
						document.querySelector('#apply-sheet-json').click();
						await new Promise(requestAnimationFrame);
						await new Promise(requestAnimationFrame);
						globalThis.smokeImportMs = performance.now() - globalThis.smokeImportStarted;
					});
					const loaded = await page.evaluate(() => {
						const errors = [...document.querySelectorAll('.main-pane .rbb-formula-error')].map(
							(e) => e.textContent
						);
						if (errors.length) throw new Error('Formula errors: ' + errors.join('; '));
						if (document.querySelectorAll('.main-pane .sb-page-title').length !== 6)
							throw new Error('Sheet import failed');
						const loaded = performance.now();
						[...document.querySelectorAll('button')]
							.find((b) => b.textContent === '📝 Sheet')
							.click();
						return {
							loaded,
							importMs: globalThis.smokeImportMs,
							resources: performance
								.getEntriesByType('resource')
								.filter((e) => e.name.includes('/_app/'))
								.map((e) => ({ transferSize: e.transferSize, encodedBodySize: e.encodedBodySize }))
						};
					});
					await page
						.getByRole('button', { name: 'Edit ' + scenario.name, exact: true })
						.evaluate((el) => el.click());
					await page.getByLabel('Root CSS class', { exact: true }).fill('smoke-c1-change');
					if (scenario.add) {
						const modal = page.getByRole('dialog', { name: 'Custom block definition editor' });
						await modal
							.getByRole('button', { name: 'Structure', exact: true })
							.evaluate((el) => el.click());
						await modal.locator('.cm-content').evaluate((el) => {
							const view = el.cmTile.root.view;
							const structure = JSON.parse(view.state.doc.toString());
							structure.content.push({
								type: 'textBlock',
								attrs: { nodeId: 'smoke-c1-added', class: 'smoke-c1-added' },
								content: [{ type: 'text', text: 'New slot' }]
							});
							view.dispatch({
								changes: { from: 0, to: view.state.doc.length, insert: JSON.stringify(structure) }
							});
						});
						await modal
							.getByRole('button', { name: 'Apply JSON', exact: true })
							.evaluate((el) => el.click());
					}
					await cdp.send('HeapProfiler.collectGarbage');
					if (allocations)
						await cdp.send('HeapProfiler.startSampling', {
							samplingInterval: 16384,
							includeObjectsCollectedByMajorGC: true,
							includeObjectsCollectedByMinorGC: true
						});
					await page.evaluate(() => {
						globalThis.smokeWrites = [];
						globalThis.smokeBeforeStorage = Object.fromEntries(
							Object.entries(localStorage).filter(([k]) => k.startsWith('rbb:custom-blocks/'))
						);
						const originalWrite = Storage.prototype.setItem;
						Storage.prototype.setItem = function (key, value) {
							if (key.startsWith('rbb:'))
								globalThis.smokeWrites.push({ key, bytes: value.length * 2 });
							return originalWrite.call(this, key, value);
						};
						globalThis.smokeRestoreWrites = () => {
							Storage.prototype.setItem = originalWrite;
						};
						globalThis.smokeLongTasks = [];
						globalThis.smokeObserver = new PerformanceObserver((list) =>
							globalThis.smokeLongTasks.push(
								...list.getEntries().map((e) => ({ start: e.startTime, ms: e.duration }))
							)
						);
						globalThis.smokeObserver.observe({ type: 'longtask' });
					});
					const before = await metrics();
					const save = await page.evaluate(async () => {
						const start = performance.now();
						const modal = document.querySelector('[aria-label="Custom block definition editor"]');
						const closed = new Promise((resolve) => {
							const observer = new MutationObserver(() => {
								if (!modal.isConnected) {
									observer.disconnect();
									resolve(performance.now());
								}
							});
							observer.observe(modal.parentElement.parentElement, {
								childList: true,
								subtree: true
							});
						});
						[...modal.querySelectorAll('button')]
							.find((b) => b.textContent === 'Save definition')
							.click();
						const closeAt = await closed;
						await new Promise(requestAnimationFrame);
						await new Promise(requestAnimationFrame);
						return { closeMs: closeAt - start, paintMs: performance.now() - start, start };
					});
					const after = await metrics();
					let sampledBytes;
					if (allocations) {
						const { profile } = await cdp.send('HeapProfiler.stopSampling');
						const sum = (node) =>
							node.selfSize + node.children.reduce((s, child) => s + sum(child), 0);
						sampledBytes = sum(profile.head);
					}
					const behavior = await page.evaluate(
						({ id, start }) => {
							globalThis.smokeRestoreWrites();
							globalThis.smokeObserver.disconnect();
							const touched = Object.entries(globalThis.smokeBeforeStorage)
								.filter(([key, value]) => localStorage.getItem(key) !== value)
								.map(([key]) => key);
							const nodes = document.querySelector('.main-pane .sheet-document').editor.getJSON();
							const visit = (node) => {
								if (
									node.attrs?.typeId === id &&
									!node.attrs.class.split(/\s+/).includes('smoke-c1-change')
								)
									throw new Error('Stale live instance: ' + id);
								node.content?.forEach(visit);
							};
							visit(nodes);
							return {
								touched,
								writes: globalThis.smokeWrites,
								longTasks: globalThis.smokeLongTasks.filter((t) => t.start >= start),
								document: nodes
							};
						},
						{ id: scenario.id, start: save.start }
					);
					await cdp.send('HeapProfiler.collectGarbage');
					const retained = await metrics();
					results.push({
						round,
						variant,
						scenario: scenario.kind,
						allocations,
						startupMs: startup,
						coldSheetLoadedMs: loaded.loaded,
						importMs: loaded.importMs,
						closeMs: save.closeMs,
						paintMs: save.paintMs,
						cpuTaskMs: (after.TaskDuration - before.TaskDuration) * 1000,
						scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
						layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
						heapBefore: before.JSHeapUsedSize,
						heapAfter: after.JSHeapUsedSize,
						heapRetained: retained.JSHeapUsedSize,
						sampledBytes,
						longTasks: behavior.longTasks,
						writes: behavior.writes,
						touched: behavior.touched,
						transferBytes: loaded.resources.reduce((s, e) => s + e.transferSize, 0),
						documentJSON: JSON.stringify(behavior.document)
					});
				}
		}
	} finally {
		for (const [origin, storage] of Object.entries(original)) {
			await page.goto(origin);
			await page.evaluate((storage) => {
				localStorage.clear();
				for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
			}, storage);
		}
		await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
		await cdp.detach();
	}
	// Both paths must produce identical live documents and storage writes.
	for (const round of new Set(results.map((r) => r.round)))
		for (const scenario of scenarios) {
			const pair = results.filter((r) => r.round === round && r.scenario === scenario.kind);
			if (
				pair[0].documentJSON !== pair[1].documentJSON ||
				JSON.stringify(pair[0].touched) !== JSON.stringify(pair[1].touched)
			)
				throw new Error('Before/after behavior mismatch: ' + scenario.kind);
		}
	return results.map((result) => {
		const row = { ...result };
		delete row.documentJSON;
		return row;
	});
}
