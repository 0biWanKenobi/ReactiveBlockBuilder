// bun scripts/experiments/c1/build.mjs [/tmp/svc-c1-benchmark]
// Builds both variants, restoring the original page even if the candidate fails.
import { readFile, writeFile, mkdir, cp, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? '/tmp/svc-c1-benchmark');
const page = new URL('../../../src/routes/+page.svelte', import.meta.url);
const original = await readFile(page, 'utf8');
await mkdir(root, { recursive: true });
try {
	await symlink(
		new URL('../../../node_modules', import.meta.url).pathname,
		resolve(root, 'node_modules')
	);
} catch (error) {
	if (error.code !== 'EEXIST') throw error;
}
const baselineLoop = `\t\t\t\tfor (const entry of library.list()) {
\t\t\t\t\tconst current = library.clone(entry.typeId)!;
\t\t\t\t\tconst structure = prepareDocument(current.structure, library);
\t\t\t\t\tif (JSON.stringify(structure) === JSON.stringify(current.structure)) continue;
\t\t\t\t\tconst synchronized = { ...current, structure };`;
if (!original.includes(baselineLoop))
	throw new Error('Expected the baseline C1 loop; inspect the page before rebuilding');
const candidate = original
	.replace(
		baselineLoop,
		`\t\t\t\tfor (const synchronized of reconcileAffectedDefinitions(
\t\t\t\t\tlibrary,
\t\t\t\t\tdefinition.typeId,
\t\t\t\t\t(typeId) => library.clone(typeId)!
\t\t\t\t)) {`
	)
	.replace(
		'<script lang="ts">',
		'<script lang="ts">\n\timport { reconcileAffectedDefinitions } from "../../scripts/experiments/c1/propagation";'
	);
try {
	for (const [variant, source] of [
		['before', original],
		['after', candidate]
	]) {
		await writeFile(page, source);
		const child = Bun.spawn(['bunx', 'vite', 'build'], { stdout: 'pipe', stderr: 'pipe' });
		const output = await new Response(child.stdout).text();
		const errors = await new Response(child.stderr).text();
		if (await child.exited) throw new Error(output + errors);
		await mkdir(resolve(root, variant), { recursive: true });
		await cp(new URL('../../../.svelte-kit/output/', import.meta.url), resolve(root, variant), {
			recursive: true
		});
		console.log('Built', variant, resolve(root, variant));
	}
} finally {
	await writeFile(page, original);
}
