// bun scripts/experiments/small-items/serve.mjs [/tmp/svc-small-items]
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportCases, dragCase, dragCSS } from './cases.mjs';
const root = resolve(process.argv[2] ?? '/tmp/svc-small-items');
const cases = new Map((await exportCases()).map((item) => [item.name, item]));
for (const [count, layout] of [
	[24, 'list'],
	[240, 'grid']
]) {
	const name = `${layout}-${count}`;
	cases.set(name, {
		name,
		sheet: dragCase(count, layout),
		storage: { 'rbb:themes/default/base.css': dragCSS }
	});
}
for (const [variant, port] of [
	['baseline', 5180],
	['u7', 5181],
	['c6', 5182]
]) {
	const output = join(root, variant);
	const { Server } = await import(pathToFileURL(join(output, 'server/index.js')).href);
	const { manifest } = await import(pathToFileURL(join(output, 'server/manifest.js')).href);
	const app = new Server(manifest);
	await app.init({ env: process.env });
	Bun.serve({
		hostname: '127.0.0.1',
		port,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname.startsWith('/__case/')) {
				const item = cases.get(url.pathname.slice(8));
				return item
					? Response.json(item, { headers: { 'cache-control': 'no-store' } })
					: new Response('Unknown case', { status: 404 });
			}
			const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
			if (path.split('/').includes('..')) return new Response('Bad path', { status: 400 });
			const file = Bun.file(join(output, 'client', path));
			if (path && (await file.exists())) return new Response(file);
			return app.respond(request, { getClientAddress: () => '127.0.0.1' });
		}
	});
	console.log(`${variant}: http://127.0.0.1:${port}`);
}
