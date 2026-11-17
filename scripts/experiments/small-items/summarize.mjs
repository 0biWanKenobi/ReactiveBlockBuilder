// bun scripts/experiments/small-items/summarize.mjs
import { format, resolveConfig } from 'prettier';
const directory = new URL('../../../docs/benchmarks/small-items/', import.meta.url);
const timing = await Bun.file(new URL('timing-raw.json', directory)).json();
const allocations = await Bun.file(new URL('allocation-raw.json', directory)).json();
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b),
		m = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};
let seed = 91082;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
function summary(rows, metric, variant) {
	const value = (row) => (Array.isArray(row[metric]) ? median(row[metric]) : row[metric]);
	const before = rows.filter((r) => r.variant === 'baseline'),
		after = rows.filter((r) => r.variant === variant);
	const deltas = before.map((b) => value(b) - value(after.find((a) => a.round === b.round)));
	const resampled = Array.from({ length: 10000 }, () =>
		median(deltas.map(() => deltas[Math.floor(random() * deltas.length)]))
	).sort((a, b) => a - b);
	return {
		before: median(before.map(value)),
		after: median(after.map(value)),
		pairedImprovement: median(deltas),
		bootstrap95: [resampled[249], resampled[9749]],
		beforeRange: [Math.min(...before.map(value)), Math.max(...before.map(value))],
		afterRange: [Math.min(...after.map(value)), Math.max(...after.map(value))]
	};
}
const result = {};
for (const item of ['U7', 'C6']) {
	result[item] = {};
	for (const name of [
		...new Set(timing.results.filter((r) => r.item === item).map((r) => r.name))
	]) {
		const rows = timing.results.filter((r) => r.item === item && r.name === name);
		const variant = item === 'U7' ? 'u7' : 'c6';
		const metrics =
			item === 'U7'
				? ['handlerMs', 'framesMs', 'taskMs', 'retained']
				: ['gap', 'placeholder', 'retained', 'gapReads', 'placeholderReads'];
		result[item][name] = Object.fromEntries(
			metrics.map((metric) => [metric, summary(rows, metric, variant)])
		);
		if (item === 'U7')
			result[item][name].allocationBytes = summary(
				allocations.results.filter((r) => r.name === name),
				'allocationBytes',
				variant
			);
	}
}
const file = new URL('summary.json', directory);
await Bun.write(
	file,
	await format(JSON.stringify(result), {
		...(await resolveConfig(file.pathname)),
		filepath: file.pathname
	})
);
console.log(JSON.stringify(result, null, 2));
