// bun scripts/experiments/c1/cold.mjs [rounds=20]
// Supplemental algorithm probe: each sample starts a new Bun process.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareDocument } from '../../../src/lib/custom-blocks/model.ts';
import { reconcileAffectedDefinitions } from './propagation.ts';

const scenarios = {
	'shared-property': 'sb-property',
	'journal-note': 'sb-template-1',
	'trait-note': 'sb-template-2',
	'note-layout-add': 'sb-template-1'
};
if (process.argv[2] === '--worker') {
	const [, , , variant, scenario] = process.argv;
	let definitions = (
		await Bun.file(new URL('../../../examples/smoke-ball/library.json', import.meta.url)).json()
	).sort((a, b) => a.typeId.localeCompare(b.typeId));
	const id = scenarios[scenario];
	const definition = structuredClone(definitions.find((d) => d.typeId === id));
	definition.rootClass = 'smoke-c1-change';
	if (scenario === 'note-layout-add')
		definition.structure.content.push({
			type: 'textBlock',
			attrs: { nodeId: 'smoke-c1-added', class: 'smoke-c1-added' },
			content: [{ type: 'text', text: 'New slot' }]
		});
	const library = {
		get: (id) => definitions.find((d) => d.typeId === id),
		list: () => definitions
	};
	const upsert = (next) => {
		definitions = [...definitions.filter((d) => d.typeId !== next.typeId), next];
	};
	upsert(definition);
	let clones = 0,
		writes = 0;
	const clone = (id) => {
		clones++;
		return structuredClone(library.get(id));
	};
	Bun.gc(true);
	const cpuBefore = process.cpuUsage();
	const start = performance.now();
	if (variant === 'before') {
		for (const entry of library.list()) {
			const current = clone(entry.typeId);
			const structure = prepareDocument(current.structure, library);
			if (JSON.stringify(structure) === JSON.stringify(current.structure)) continue;
			const changed = { ...current, structure };
			JSON.stringify(changed, null, 2);
			writes++;
			upsert(changed);
		}
	} else {
		for (const changed of reconcileAffectedDefinitions(library, id, clone)) {
			JSON.stringify(changed, null, 2);
			writes++;
			upsert(changed);
		}
	}
	const ms = performance.now() - start;
	const cpu = process.cpuUsage(cpuBefore);
	const digest = createHash('sha256')
		.update(JSON.stringify([...definitions].sort((a, b) => a.typeId.localeCompare(b.typeId))))
		.digest('hex');
	console.log(
		JSON.stringify({
			variant,
			scenario,
			ms,
			cpuMs: (cpu.user + cpu.system) / 1000,
			clones,
			dependentWrites: writes,
			digest
		})
	);
} else {
	const results = [];
	const rounds = Number(process.argv[2] ?? 20);
	for (let round = 0; round < rounds; round++)
		for (const scenario of Object.keys(scenarios)) {
			const pair = [];
			for (const variant of round % 2 ? ['after', 'before'] : ['before', 'after']) {
				const child = Bun.spawnSync(
					[process.execPath, import.meta.filename, '--worker', variant, scenario],
					{ stdout: 'pipe', stderr: 'pipe' }
				);
				if (child.exitCode) throw new Error(child.stderr.toString());
				const row = JSON.parse(child.stdout.toString());
				pair.push(row);
				results.push({ round, ...row });
			}
			assert.equal(pair[0].digest, pair[1].digest, 'Different reconciliation results');
		}
	console.log(
		JSON.stringify({ runtime: Bun.version, coldProcesses: results.length, results }, null, 2)
	);
}
