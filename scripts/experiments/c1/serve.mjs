// bun scripts/experiments/c1/serve.mjs <snapshot-output-directory> <port>
// Serves an unchanged production SvelteKit output for embedded-browser measurements.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSmokeBallBundle } from '../../../examples/smoke-ball/bundle.mjs';
const fixture = JSON.stringify(await createSmokeBallBundle(), null, 2) + '\n';
const root = resolve(process.argv[2]);
const { Server } = await import(pathToFileURL(join(root, 'server/index.js')).href);
const { manifest } = await import(pathToFileURL(join(root, 'server/manifest.js')).href);
const app = new Server(manifest);
await app.init({ env: process.env });
const server = Bun.serve({
	hostname: '127.0.0.1',
	port: Number(process.argv[3]),
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/smoke-ball-bench.json')
			return new Response(fixture, {
				headers: { 'cache-control': 'no-store', 'content-type': 'application/json' }
			});
		const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
		if (pathname.split('/').includes('..')) return new Response('Bad path', { status: 400 });
		const asset = Bun.file(join(root, 'client', pathname));
		if (pathname && (await asset.exists())) return new Response(asset);
		return app.respond(request, { getClientAddress: () => '127.0.0.1' });
	}
});
console.log('Production benchmark:', server.url.href, root);
