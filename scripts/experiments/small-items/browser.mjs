// User-authorized external Edge exception for this evaluation; isolated profiles.
// bun scripts/experiments/small-items/browser.mjs <output.json> [pairs=10] [kind=all]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Supply the output JSON path');
const pairs = Number(process.argv[3] ?? 10);
const kind = process.argv[4] ?? 'all';
if (!Number.isSafeInteger(pairs) || pairs < 1) throw new Error('Pairs must be a positive integer');
if (!['all', 'export', 'drag', 'allocations', 'work'].includes(kind))
	throw new Error('Unknown evaluation kind: ' + kind);
const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
	stdout: 'pipe',
	stderr: 'pipe'
});
if (revision.exitCode) throw new Error(revision.stderr.toString());
const baseline = revision.stdout.toString().trim();
const results = [];
let version;

async function open(variant, name) {
	// A new browser process/profile per sample: no browser cache or warmed app realm.
	const browser = await chromium.launch({ channel: 'msedge', headless: true });
	version = browser.version();
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await context.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === '127.0.0.1') return route.continue();
		if (route.request().resourceType() === 'image')
			return route.fulfill({
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120"/>'
			});
		return route.abort();
	});
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const origin = `http://127.0.0.1:${{ baseline: 5180, u7: 5181, c6: 5182 }[variant]}`;
	await page.goto(origin);
	const fixture = await page.evaluate(
		async (name) => (await fetch('/__case/' + name)).json(),
		name
	);
	await page.evaluate((storage) => {
		for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
	}, fixture.storage);
	await page.reload();
	await page.waitForFunction(
		() => {
			const button = [...document.querySelectorAll('button')].find(
				(b) => b.textContent === '{ } Definition'
			);
			if (!button) return false;
			if (button.getAttribute('aria-pressed') !== 'true') {
				button.click();
				return false;
			}
			return !!document.querySelector('.source-panel .cm-content');
		},
		null,
		{ polling: 20 }
	);
	await page.locator('.source-panel .cm-content').evaluate((el, sheet) => {
		const view = el.cmTile.root.view;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: JSON.stringify(sheet) }
		});
		document.querySelector('#apply-sheet-json').click();
	}, fixture.sheet);
	await page.waitForFunction(
		() => document.querySelector('[role=status]')?.textContent === 'Sheet loaded'
	);
	await page.evaluate(async () => {
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
	});
	const cdp = await context.newCDPSession(page);
	await cdp.send('Performance.enable');
	return { browser, page, cdp, fixture };
}

const metrics = async (cdp) =>
	Object.fromEntries(
		(await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])
	);
const hash = (text) => Bun.hash(text).toString(16);

async function measureExport(variant, name, profile = false, probe = false) {
	const { browser, page, cdp, fixture } = await open(variant, name);
	try {
		await cdp.send('HeapProfiler.collectGarbage');
		if (probe)
			await page.evaluate((fieldCount) => {
				const original = structuredClone;
				globalThis.cloneCalls = [];
				globalThis.structuredClone = (...args) => {
					const start = performance.now();
					const result = original(...args);
					const ms = performance.now() - start;
					const value = args[0];
					if (
						value &&
						typeof value === 'object' &&
						!Array.isArray(value) &&
						Object.keys(value).length === fieldCount &&
						Object.values(value).every((record) => record && typeof record.formula === 'string')
					) {
						globalThis.cloneCalls.push({ ms, fields: fieldCount });
					}
					return result;
				};
				globalThis.restoreClone = () => {
					globalThis.structuredClone = original;
				};
			}, Object.keys(fixture.sheet.fields).length);
		if (profile)
			await cdp.send('HeapProfiler.startSampling', {
				samplingInterval: 8192,
				includeObjectsCollectedByMajorGC: true,
				includeObjectsCollectedByMinorGC: true
			});
		const before = await metrics(cdp);
		const measured = await page.evaluate(async () => {
			const start = performance.now();
			document.querySelector('#sync-sheet-json').click();
			const handlerMs = performance.now() - start;
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
			return { handlerMs, framesMs: performance.now() - start };
		});
		const after = await metrics(cdp);
		const cloneCalls = probe
			? await page.evaluate(() => {
					globalThis.restoreClone();
					return globalThis.cloneCalls;
				})
			: undefined;
		let allocationBytes;
		if (profile) {
			const { profile: allocation } = await cdp.send('HeapProfiler.stopSampling');
			const sum = (node) =>
				node.selfSize + node.children.reduce((total, child) => total + sum(child), 0);
			allocationBytes = sum(allocation.head);
		}
		// Read/assert outside the measured region. No field mutation is allowed.
		const exported = await page
			.locator('.source-panel .cm-content')
			.evaluate((el) => el.cmTile.root.view.state.doc.toString());
		assert.deepStrictEqual(JSON.parse(exported).fields, fixture.sheet.fields);
		await cdp.send('HeapProfiler.collectGarbage');
		const retained = await metrics(cdp);
		// Subsequent field edits must not change the already serialized export.
		const field = Object.keys(fixture.sheet.fields)[0];
		await page.getByLabel('Formula for ' + field, { exact: true }).fill('2');
		assert.equal(
			await page
				.locator('.source-panel .cm-content')
				.evaluate((el) => el.cmTile.root.view.state.doc.toString()),
			exported
		);
		return {
			variant,
			name,
			profile,
			cloneCalls,
			detachedExport: true,
			...measured,
			taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
			heapBefore: before.JSHeapUsedSize,
			heapAfter: after.JSHeapUsedSize,
			retained: retained.JSHeapUsedSize,
			allocationBytes,
			jsonHash: hash(exported),
			exportBytes: exported.length * 2
		};
	} finally {
		await browser.close();
	}
}

async function measureDrag(variant, name) {
	const { browser, page, cdp, fixture } = await open(variant, name);
	try {
		await page.getByRole('button', { name: '📝 Sheet', exact: true }).click();
		await page.locator('.main-pane').getByRole('button', { name: 'Drag', exact: true }).click();
		await page.waitForFunction(
			() => document.querySelector('.main-pane .sheet-document')?.dataset.rbbDragMode === 'true'
		);
		await page.evaluate(() => {
			const editor = document.querySelector('.main-pane .sheet-document').editor;
			editor.commands.setNodeSelection(1);
			editor.view.dragging = {
				slice: editor.state.selection.content(),
				move: true,
				node: editor.state.selection
			};
		});
		const samples = await page.evaluate(async () => {
			const editor = document.querySelector('.main-pane .sheet-document').editor;
			const container = editor.view.dom.querySelector('.drag-study');
			const transfer = new DataTransfer();
			transfer.setData('text/html', '<span>Item 1</span>');
			const frame = () => new Promise(requestAnimationFrame);
			const over = (x, y) =>
				container.dispatchEvent(
					new DragEvent('dragover', {
						bubbles: true,
						cancelable: true,
						clientX: x,
						clientY: y,
						dataTransfer: transfer
					})
				);
			const clear = () =>
				editor.view.dom.dispatchEvent(
					new DragEvent('dragleave', { bubbles: true, relatedTarget: null })
				);
			const points = () => {
				const card = container.querySelectorAll('.drag-card')[4];
				const rect = card.getBoundingClientRect();
				return container.classList.contains('drag-grid')
					? [rect.right + 5, rect.top + rect.height / 2]
					: [rect.left + rect.width / 2, rect.bottom + 5];
			};
			const result = { gap: [], placeholder: [] };
			for (let i = 0; i < 16; i++) {
				clear();
				await frame();
				await frame();
				const [x, y] = points();
				const start = performance.now();
				over(x, y);
				result.gap.push(performance.now() - start);
				await frame();
				await frame();
				const placeholder = editor.view.dom.querySelector('.rbb-drop-placeholder');
				if (!placeholder) throw new Error('Missing drag preview');
				const rect = placeholder.getBoundingClientRect();
				const stable = performance.now();
				over(rect.left + rect.width / 2, rect.top + rect.height / 2);
				result.placeholder.push(performance.now() - stable);
			}
			// Untimed instrumentation proves the candidate removes the intended reads.
			clear();
			await frame();
			await frame();
			const [x, y] = points();
			const original = Element.prototype.getBoundingClientRect;
			let reads = 0;
			Element.prototype.getBoundingClientRect = function () {
				reads++;
				return original.call(this);
			};
			let gapReads, placeholderReads;
			try {
				over(x, y);
				gapReads = reads;
				const node = editor.view.dom.querySelector('.rbb-drop-placeholder');
				const rect = original.call(node);
				reads = 0;
				over(rect.left + rect.width / 2, rect.top + rect.height / 2);
				placeholderReads = reads;
			} finally {
				Element.prototype.getBoundingClientRect = original;
			}
			const placeholder = editor.view.dom.querySelector('.rbb-drop-placeholder');
			const target = Number(placeholder.dataset.dropPosition);
			const rect = placeholder.getBoundingClientRect();
			container.dispatchEvent(
				new DragEvent('drop', {
					bubbles: true,
					cancelable: true,
					clientX: rect.left + 2,
					clientY: rect.top + 2,
					dataTransfer: transfer
				})
			);
			if (editor.view.dom.querySelector('.rbb-drop-placeholder'))
				throw new Error('Drop did not clean up');
			return {
				...result,
				gapReads,
				placeholderReads,
				target,
				json: JSON.stringify(editor.getJSON()),
				text: editor.state.doc.textContent
			};
		});
		await cdp.send('HeapProfiler.collectGarbage');
		const retained = await metrics(cdp);
		assert.equal(page.url().includes('127.0.0.1'), true);
		return {
			variant,
			name,
			gap: samples.gap,
			placeholder: samples.placeholder,
			gapReads: samples.gapReads,
			placeholderReads: samples.placeholderReads,
			target: samples.target,
			jsonHash: hash(samples.json),
			retained: retained.JSHeapUsedSize,
			nodes: fixture.sheet.document.content[0].content.length
		};
	} finally {
		await browser.close();
	}
}

try {
	for (let round = 0; round < pairs; round++) {
		if (kind === 'all' || kind === 'export')
			for (const name of ['small-8', 'smoke-238', 'ledger-2048']) {
				const rows = [];
				for (const variant of round % 2 ? ['u7', 'baseline'] : ['baseline', 'u7'])
					rows.push({
						round,
						item: 'U7',
						...(await measureExport(variant, name))
					});
				assert.equal(rows[0].jsonHash, rows[1].jsonHash, 'Export differs');
				results.push(...rows);
			}
		if (kind === 'allocations' || kind === 'work')
			for (const name of ['small-8', 'smoke-238', 'ledger-2048']) {
				const rows = [];
				for (const variant of round % 2 ? ['u7', 'baseline'] : ['baseline', 'u7'])
					rows.push({
						round,
						item: 'U7',
						...(await measureExport(variant, name, kind === 'allocations', kind === 'work'))
					});
				assert.equal(rows[0].jsonHash, rows[1].jsonHash);
				results.push(...rows);
			}
		if (kind === 'all' || kind === 'drag')
			for (const name of ['list-24', 'grid-240']) {
				const rows = [];
				for (const variant of round % 2 ? ['c6', 'baseline'] : ['baseline', 'c6'])
					rows.push({ round, item: 'C6', ...(await measureDrag(variant, name)) });
				assert.equal(rows[0].jsonHash, rows[1].jsonHash, 'Drop output differs');
				assert.equal(rows[0].target, rows[1].target);
				results.push(...rows);
			}
		await mkdir(dirname(output), { recursive: true });
		await writeFile(
			output,
			JSON.stringify(
				{
					edge: version,
					baseline,
					freshBrowserPerSample: true,
					pairsRequested: pairs,
					completedPairs: round + 1,
					kind,
					results
				},
				null,
				2
			) + '\n'
		);
		console.log('Completed round', round + 1, 'of', pairs, kind);
	}
} catch (error) {
	await mkdir(dirname(output), { recursive: true });
	await writeFile(
		output,
		JSON.stringify({ error: String(error), edge: version, results }, null, 2) + '\n'
	);
	throw error;
}
