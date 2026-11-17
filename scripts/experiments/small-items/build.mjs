// bun scripts/experiments/small-items/build.mjs [/tmp/svc-small-items]
import { readFile, writeFile, mkdir, cp, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exportCandidate, dragCandidate } from './patches.mjs';
const project = new URL('../../../', import.meta.url);
const output = resolve(process.argv[2] ?? '/tmp/svc-small-items');
const files = {
	export: new URL('src/routes/components/mainPane/sourcePanels.svelte', project),
	drag: new URL('src/lib/editor/blockDragPreview.ts', project),
	button: new URL('src/lib/components/Button.svelte', project),
	types: new URL('src/lib/types/shared.ts', project)
};
const originals = Object.fromEntries(
	await Promise.all(
		Object.entries(files).map(async ([key, file]) => [key, await readFile(file, 'utf8')])
	)
);
const restore = async () => {
	for (const [key, file] of Object.entries(files)) await writeFile(file, originals[key]);
};
await mkdir(output, { recursive: true });
try {
	await symlink(new URL('node_modules', project).pathname, resolve(output, 'node_modules'));
} catch (error) {
	if (error.code !== 'EEXIST') throw error;
}
const evidence = {};
try {
	for (const variant of ['baseline', 'u7', 'u8', 'c6']) {
		await restore();
		if (variant === 'u7') await writeFile(files.export, exportCandidate(originals.export));
		if (variant === 'c6') await writeFile(files.drag, dragCandidate(originals.drag));
		if (variant === 'u8') {
			await rm(files.button);
			await writeFile(
				files.types,
				originals.types
					.replace("import type { SvelteHTMLElements } from 'svelte/elements';\n", '')
					.replace('export type HtmlTag = keyof SvelteHTMLElements;\n', '')
			);
		}
		const build = Bun.spawn(['bunx', 'vite', 'build'], {
			cwd: project.pathname,
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const [stdout, stderr] = await Promise.all([
			new Response(build.stdout).text(),
			new Response(build.stderr).text()
		]);
		if (await build.exited) throw new Error(stdout + stderr);
		await cp(new URL('.svelte-kit/output/', project), resolve(output, variant), {
			recursive: true
		});
		const client = resolve(output, variant, 'client');
		const assets = [];
		for await (const file of new Bun.Glob('**/*.js').scan(client)) {
			const bytes = await Bun.file(resolve(client, file)).arrayBuffer();
			assets.push({
				file,
				bytes: bytes.byteLength,
				sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
			});
		}
		const sources = new Set();
		for await (const file of new Bun.Glob('**/*.map').scan(client)) {
			const map = await Bun.file(resolve(client, file)).json();
			for (const source of map.sources ?? []) sources.add(source);
		}
		evidence[variant] = {
			assets: assets.sort((a, b) => a.file.localeCompare(b.file)),
			appSources: [...sources].filter((s) => s.includes('/src/')).sort(),
			buttonInBundle: [...sources].some((s) => s.endsWith('/Button.svelte'))
		};
		console.log('Built', variant);
	}
	await writeFile(resolve(output, 'build-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
} finally {
	await restore();
}
