// bun examples/smoke-ball/bundle.mjs [output.json]
// Assemble the browser payload from the canonical example files.
export async function createSmokeBallBundle() {
	const [sheet, definitions, css, { metadata }] = await Promise.all([
		Bun.file(new URL('./sheet.json', import.meta.url)).json(),
		Bun.file(new URL('./library.json', import.meta.url)).json(),
		Bun.file(new URL('./style.css', import.meta.url)).text(),
		Bun.file(new URL('./conversion.json', import.meta.url)).json()
	]);
	const storage = Object.fromEntries(
		definitions.flatMap((definition) => [
			[`rbb:custom-blocks/${definition.typeId}.json`, JSON.stringify(definition, null, 2)],
			[`rbb:themes/default/blocks/${definition.typeId}.css`, '']
		])
	);
	storage['rbb:themes/default/base.css'] = css;
	return { sheet, storage, metadata };
}

if (import.meta.main) {
	const json = JSON.stringify(await createSmokeBallBundle(), null, 2) + '\n';
	if (process.argv[2]) await Bun.write(process.argv[2], json);
	else console.log(json.trimEnd());
}
