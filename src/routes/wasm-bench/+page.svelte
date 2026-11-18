<script lang="ts">
	import { onMount } from 'svelte';
	import smokeBall from '../../../examples/smoke-ball/sheet.json';
	import { releaseSheet, resolve, resolveCompact, type Sheet } from '$lib/formula/engine';

	type Preview = { value: number | boolean | null; rollable: boolean; expression?: string };
	type Result = { case: string; full: number[]; compact: number[]; fullMedianMs: number; compactMedianMs: number; speedup: number };
	type Report = { fields: number; visibleFields: number; sharedRoot: string; affectedFields: number; runs: number; comparisons: number; cases: Result[]; environment: string };
	let status = $state('Running smoke-ball formula benchmark...');
	let report = $state<Report | null>(null);
	const base = smokeBall.fields as Sheet;
	const entries = Object.entries(base);
	const ids = entries.map(([id]) => id);
	const source = (id: string) => base[id].formula;

	function median(values: number[]) {
		const s = [...values].sort((a, b) => a - b);
		return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
	}
	function present(x: Preview) {
		return JSON.stringify({ value: x.value ?? null, rollable: x.rollable, expression: x.rollable ? x.expression : null });
	}
	function visibleFields() {
		const visible = new Set<string>();
		function walk(node: any) {
			if (!node || typeof node !== 'object') return;
			if (node.type === 'formula' && typeof node.attrs?.field === 'string') visible.add(node.attrs.field);
			if (Array.isArray(node.content)) node.content.forEach(walk);
		}
		walk(smokeBall.document);
		return [...visible].filter((id) => id in base);
	}
	function selectSharedRoot() {
		const reverse = new Map<string, Set<string>>();
		for (const [id, entry] of entries) {
			for (const match of entry.formula.matchAll(/\{([^}]+)\}/g)) {
				const dependents = reverse.get(match[1]) ?? new Set<string>();
				dependents.add(id);
				reverse.set(match[1], dependents);
			}
		}
		let best = { root: '', affected: [] as string[] };
		for (const id of ids) {
			if (!/^\d+(?:\.\d+)?$/.test(source(id).trim())) continue;
			const affected = new Set<string>();
			const queue = [id];
			while (queue.length) {
				const next = queue.pop()!;
				if (affected.has(next)) continue;
				affected.add(next);
				queue.push(...(reverse.get(next) ?? []));
			}
			if (affected.size > best.affected.length) best = { root: id, affected: [...affected] };
		}
		return best;
	}

	onMount(async () => {
		const full = structuredClone(base) as Sheet;
		const compact = structuredClone(base) as Sheet;
		let comparisons = 0;
		const cases: Result[] = [];
		const runs = 20;
		const visible = visibleFields();
		const root = selectSharedRoot();
		try {
			// Warm WASM contexts and verify every field using the real 238-field fixture.
			for (const id of ids) {
				let a: Preview | undefined;
				let b: Preview | undefined;
				let errA = '';
				let errB = '';
				try { a = resolve(full, id); } catch (error) { errA = String(error); }
				try { b = resolveCompact(compact, id); } catch (error) { errB = String(error); }
				if (errA !== errB || (!errA && present(a!) !== present(b!))) {
					throw Error(`Full / compact mismatch at ${id}: ${errA || present(a!)} != ${errB || present(b!)}`);
				}
				comparisons++;
			}
			function bench(name: string, targets: string[], mutate: boolean) {
				const times = { full: [] as number[], compact: [] as number[] };
				const methods = { full: (sheet: Sheet, id: string) => resolve(sheet, id), compact: (sheet: Sheet, id: string) => resolveCompact(sheet, id) };
				const sheets = { full, compact };
				for (let i = -3; i < runs; i++) {
					if (mutate && root.root) {
						for (const sheet of [full, compact]) sheet[root.root].formula = String(Number(source(root.root)) + (i % 2 === 0 ? 1 : 2));
					}
					const order: Array<'full' | 'compact'> = i % 2 ? ['compact', 'full'] : ['full', 'compact'];
					for (const method of order) {
						const before = performance.now();
						for (const id of targets) {
							try { methods[method](sheets[method], id); } catch { /* Match errored field workload across APIs. */ }
						}
						const duration = performance.now() - before;
						if (i >= 0) times[method].push(duration);
					}
				}
				const fullMedianMs = median(times.full);
				const compactMedianMs = median(times.compact);
				cases.push({ case: name, full: times.full, compact: times.compact, fullMedianMs, compactMedianMs, speedup: fullMedianMs / compactMedianMs });
			}
			bench('All 238 fields (warm)', ids, false);
			bench('Visible distinct formula fields (warm)', visible, false);
			bench('Source edit: all displayed fields', visible, true);
			// Restore both copies before repeating the entire set.
			for (const sheet of [full, compact]) sheet[root.root].formula = source(root.root);
			bench('Source edit: all fields', ids, true);
			report = { fields: ids.length, visibleFields: visible.length, sharedRoot: root.root, affectedFields: root.affected.length, runs, comparisons, cases, environment: navigator.userAgent };
			(window as any).__wasmBenchResult = report;
			status = 'Completed; full and compact semantics match on every fixture field.';
		} catch (error) {
			status = 'FAILED: ' + String(error);
			(window as any).__wasmBenchError = String(error);
		} finally {
			releaseSheet(full);
			releaseSheet(compact);
		}
	});
</script>

<svelte:head><title>WASM compact API benchmark</title></svelte:head>
<h1>Smoke-ball WASM API benchmark</h1>
<p id="wasm-bench-status">{status}</p>
{#if report}
	<pre id="wasm-bench-json">{JSON.stringify(report, null, 2)}</pre>
{/if}
