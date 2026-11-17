// bun scripts/experiments/c1/summarize.mjs
import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
const directory = new URL('../../../docs/benchmarks/c1-smoke-ball/', import.meta.url);
const data = await Bun.file(new URL('browser-raw.json', directory)).json();
const cold = await Bun.file(new URL('cold-process-raw.json', directory)).json();
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let seed = 512938;
const random = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
function paired(rows, metric) {
	const rounds = [...new Set(rows.map((r) => r.round))];
	const deltas = rounds.map((round) => {
		const pair = rows.filter((r) => r.round === round);
		return (
			pair.find((r) => r.variant === 'before')[metric] -
			pair.find((r) => r.variant === 'after')[metric]
		);
	});
	const samples = Array.from({ length: 10000 }, () =>
		median(deltas.map(() => deltas[Math.floor(random() * deltas.length)]))
	).sort((a, b) => a - b);
	return {
		medianImprovement: median(deltas),
		bootstrap95: [samples[249], samples[9749]],
		pairedValues: deltas
	};
}
const summarize = (rows, metrics) => ({
	...Object.fromEntries(
		['before', 'after'].map((variant) => {
			const samples = rows.filter((r) => r.variant === variant);
			return [
				variant,
				Object.fromEntries(
					metrics.map((metric) => {
						const values = samples.map((r) => r[metric]);
						return [
							metric,
							{ median: median(values), range: [Math.min(...values), Math.max(...values)] }
						];
					})
				)
			];
		})
	),
	paired: Object.fromEntries(metrics.map((metric) => [metric, paired(rows, metric)]))
});
const scenarios = [...new Set(data.timing.map((r) => r.scenario))];
const summary = Object.fromEntries(
	scenarios.map((scenario) => [
		scenario,
		{
			timing: summarize(
				data.timing.filter((r) => r.scenario === scenario),
				[
					'startupMs',
					'coldSheetLoadedMs',
					'importMs',
					'closeMs',
					'paintMs',
					'cpuTaskMs',
					'heapRetained'
				]
			),
			allocations: summarize(
				data.allocations.filter((r) => r.scenario === scenario),
				['sampledBytes']
			),
			coldProcess: summarize(
				cold.results.filter((r) => r.scenario === scenario),
				['ms', 'cpuMs', 'clones', 'dependentWrites']
			)
		}
	])
);
const summaryFile = new URL('summary.json', directory);
await writeFile(
	summaryFile,
	await format(JSON.stringify(summary), {
		...(await resolveConfig(summaryFile.pathname)),
		filepath: summaryFile.pathname
	})
);
for (const [scenario, result] of Object.entries(summary))
	console.log(
		JSON.stringify({
			scenario,
			beforeSave: result.timing.before.closeMs.median,
			afterSave: result.timing.after.closeMs.median,
			pairedSave: result.timing.paired.closeMs,
			beforeCPU: result.timing.before.cpuTaskMs.median,
			afterCPU: result.timing.after.cpuTaskMs.median,
			coldCPU: [result.coldProcess.before.cpuMs.median, result.coldProcess.after.cpuMs.median],
			allocated: [
				result.allocations.before.sampledBytes.median,
				result.allocations.after.sampledBytes.median
			],
			retained: [result.timing.before.heapRetained.median, result.timing.after.heapRetained.median]
		})
	);
