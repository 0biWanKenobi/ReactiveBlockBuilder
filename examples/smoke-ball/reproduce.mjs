// bun examples/smoke-ball/reproduce.mjs /path/to/Smoke_Ball
// The supplied archive is data. Nothing inside it is executed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { prepareDocument, validateDefinition } from '../../src/lib/custom-blocks/model.ts';

const archive = process.argv[2];
if (!archive) throw new Error('Supply the Smoke_Ball archive path');
const source = JSON.parse(execFileSync('unzip', ['-p', archive, 'scheme'], { encoding: 'utf8' }));
const output = new URL('./', import.meta.url);
await mkdir(output, { recursive: true });
const properties = new Map();
const collect = (value) => {
	if (Array.isArray(value)) return value.forEach(collect);
	if (!value || typeof value !== 'object') return;
	if (value.uid && typeof value.formula === 'string') properties.set(value.uid, value);
	Object.values(value).forEach(collect);
};
collect(source);
const slug = (name) =>
	name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/gi, '_')
		.replace(/^_|_$/g, '')
		.toUpperCase();
const ids = new Map([...properties].map(([uid, p], i) => [uid, `F${i}_${slug(p.name)}`]));
const reference = (uid) => {
	if (!ids.has(uid)) throw new Error('Unknown property: ' + uid);
	return `{${ids.get(uid)}}`;
};

// Translate the export's infix min/max and equality into current formula syntax.
function translate(input) {
	const text = input.replace(/\{([^}]+)\}/g, (_, uid) => reference(uid));
	const tokens = text.match(/\{[^}]+\}|\d+(?:\.\d+)?|true|false|max|min|[()+\-*/=d]/g) ?? [];
	if (tokens.join('') !== text.replace(/\s+/g, ''))
		throw new Error('Unsupported formula: ' + input);
	let index = 0;
	const precedence = { '=': 1, max: 2, min: 2, '+': 3, '-': 3, '*': 4, '/': 4, d: 5 };
	function expression(minimum = 0) {
		let token = tokens[index++];
		let left;
		if (token === '(') {
			left = expression();
			if (tokens[index++] !== ')') throw new Error('Unbalanced formula');
		} else if (token === '-' || token === '+') left = `(${token}${expression(6)})`;
		else if (token === 'd') {
			index--;
			left = '1';
		} else if (token && (token.startsWith('{') || /^(?:\d|true|false)/.test(token))) left = token;
		else throw new Error('Unexpected formula token: ' + token);
		while (index < tokens.length && (precedence[tokens[index]] ?? -1) >= minimum) {
			const op = tokens[index++];
			const right = expression(precedence[op] + 1);
			left =
				op === 'max' || op === 'min'
					? `${op}(${left},${right})`
					: op === 'd'
						? `(${left})d${right}`
						: `(${left}${op === '=' ? '==' : op}${right})`;
		}
		return left;
	}
	const result = expression();
	if (index !== tokens.length) throw new Error('Unconsumed formula: ' + input);
	return result;
}
const fields = {};
const formulaAudit = [];
for (const [uid, p] of properties) {
	let formula = translate(p.formula);
	// D&D score modifiers/proficiency and sneak dice counts require integer rounding.
	if (p.uid === 'a7196370-534b-439a-a60d-f34e0d148cec' || /\/2-5/.test(p.formula))
		formula = `floor(${formula})`;
	formula = formula.replace(/\((\([^()]*\)\/2)\)d6/g, '(floor($1))d6');
	const id = ids.get(uid);
	fields[id] = { id, formula };
	formulaAudit.push({ uid, name: p.name, original: p.formula, translated: formula });
}
// Only active page elements contribute bonuses; unused templates do not equip items.
for (const page of source.pages)
	for (const element of page.content) {
		for (const bonus of element.bonuses ?? []) {
			const id = ids.get(bonus.propertyUid);
			fields[id].formula =
				`(${fields[id].formula})+(${bonus.condition ? reference(bonus.condition) : '1'})*${reference(bonus.valuePropertyUid)}`;
		}
	}
for (const [uid, p] of properties)
	if (p.rollMode === 'base_roll') {
		const id = ids.get(uid) + '_ROLL';
		fields[id] = { id, formula: `${reference(p.rollAsBonusTo)}+${reference(uid)}` };
	}

let serial = 0;
const attrs = (className) => ({ nodeId: `sb-${++serial}`, class: className, customNode: false });
const text = (value, className = 'sb-text') => ({
	type: 'textBlock',
	attrs: attrs(className),
	content: value ? [{ type: 'text', text: value }] : []
});
const container = (content, className) => ({
	type: 'container',
	attrs: { ...attrs(className), typeId: '', instanceId: '' },
	content
});
const formula = (uid, className, roll = false) => ({
	type: 'formula',
	attrs: {
		...attrs(className),
		field: ids.get(uid) + (roll ? '_ROLL' : ''),
		label: properties.get(uid).name,
		showLabel: false
	}
});
const definitions = [];
const library = { list: () => definitions, get: (id) => definitions.find((d) => d.typeId === id) };
function define(typeId, name, structure) {
	const definition = { typeId, name, rootClass: '', structure };
	validateDefinition(definition, library);
	definitions.push(definition);
	return definition;
}
function instance(definition, values = definition.structure) {
	const root = structuredClone(values);
	// Instances use definition slots; their text/formula values remain independently editable.
	const slots = (template, current) => {
		current.attrs = { ...current.attrs, nodeId: template.attrs.nodeId };
		if (!template.attrs.customNode)
			template.content?.forEach((child, i) => {
				if (child.type !== 'text') slots(child, current.content[i]);
			});
	};
	slots(definition.structure, root);
	root.attrs = {
		...root.attrs,
		customNode: true,
		typeId: definition.typeId,
		nodeId: `sb-${++serial}`,
		instanceId: `sb-instance-${serial}`
	};
	return root;
}
const firstProperty = [...properties.keys()][1];
const propertyRow = define(
	'sb-property',
	'Property row',
	container(
		[text('Property', 'sb-property-label'), formula(firstProperty, 'sb-property-value')],
		'sb-property'
	)
);
const propertyInstance = (uid, label) =>
	instance(
		propertyRow,
		container([text(label, 'sb-property-label'), formula(uid, 'sb-property-value')], 'sb-property')
	);
function elementStructure(element, forceDescription = false) {
	const visible = element.showPropertiesOnPage
		? (element.properties ?? []).filter(
				(p) =>
					!p.customization &&
					p.uid !== element.primaryPropertyUid &&
					p.uid !== element.secondaryPropertyUid
			)
		: [];
	const description = element.showDescriptionOnPage ? (element.description ?? '') : '';
	const compact =
		element.uiMode !== 'header' &&
		element.primaryPropertyUid &&
		!properties.get(element.primaryPropertyUid).counterMaxProperty &&
		!element.secondaryPropertyUid &&
		!visible.length &&
		!description &&
		!element.shortInfo;
	const content = compact
		? [propertyInstance(element.primaryPropertyUid, element.title.trim())]
		: [text(element.title.trim(), 'sb-title')];
	if (!compact && element.primaryPropertyUid) {
		content.push(formula(element.primaryPropertyUid, 'sb-primary'));
		const primary = properties.get(element.primaryPropertyUid);
		if (primary.allowIncrementCounter && primary.counterMaxProperty) {
			content.push(
				text('/', 'sb-counter-separator'),
				formula(primary.counterMaxProperty, 'sb-counter-max')
			);
		}
		if (primary.rollMode === 'base_roll')
			content.push(formula(element.primaryPropertyUid, 'sb-roll', true));
	}
	if (element.secondaryPropertyUid)
		content.push(formula(element.secondaryPropertyUid, 'sb-secondary'));
	if (element.shortInfo) content.push(text(element.shortInfo, 'sb-info'));
	for (const p of visible) content.push(propertyInstance(p.uid, p.name));
	if (description || forceDescription) content.push(text(description, 'sb-description'));
	return container(content, `sb-card sb-${element.uiMode.replaceAll('_', '-')}`);
}
function shapeKey(node) {
	return JSON.stringify([
		node.type,
		node.attrs?.class,
		node.attrs?.typeId,
		!!node.attrs?.field?.endsWith('_ROLL'),
		(node.content ?? []).filter((n) => n.type !== 'text').map(shapeKey)
	]);
}
// Keep only the seven source templates and one shared property-row primitive.
// Pages/headings/one-off equipment remain stock containers, not definitions.
const templates = source.core.templates.map((template, i) =>
	define(`sb-template-${i + 1}`, template.title, elementStructure(template, i < 2))
);
function elementNode(element, pageIndex) {
	const simpleNote =
		element.uiMode === 'row' &&
		!element.primaryPropertyUid &&
		!element.secondaryPropertyUid &&
		!element.properties?.length &&
		!element.shortInfo;
	const structure = elementStructure(element, simpleNote);
	if (simpleNote) return instance(templates[pageIndex === 1 ? 1 : 0], structure);
	const compatible = templates.slice(2).find((t) => shapeKey(t.structure) === shapeKey(structure));
	return compatible ? instance(compatible, structure) : structure;
}
const pages = source.pages.map((page, i) =>
	container(
		[text(page.name, 'sb-page-title'), ...page.content.map((element) => elementNode(element, i))],
		`sb-page sb-page-${i + 1}`
	)
);
const document = prepareDocument(
	{
		type: 'doc',
		content: [
			container(
				[
					text(source.name, 'sb-character-name'),
					text('Tabaxi · Ladro / Spadaccino · Livello 17', 'sb-character-subtitle')
				],
				'sb-character'
			),
			...pages
		]
	},
	library
);
const sheet = { version: 1, themeId: 'default', fields, document };
const count = (n) => 1 + (n.content ?? []).reduce((sum, child) => sum + count(child), 0);
const metadata = {
	name: source.name,
	sourceSha256: createHash('sha256')
		.update(new Uint8Array(await Bun.file(archive).arrayBuffer()))
		.digest('hex'),
	pages: source.pages.map((p) => ({ name: p.name, elements: p.content.length })),
	sourceProperties: properties.size,
	fields: Object.keys(fields).length,
	sourceTemplates: source.core.templates.length,
	definitions: definitions.length,
	documentNodes: count(document),
	definitionNodes: definitions.reduce((sum, d) => sum + count(d.structure), 0),
	templates: definitions.map((d) => ({ id: d.typeId, name: d.name })),
	adaptations: [
		'Pages are stacked sections; no native page navigation.',
		'Counters/checkboxes use editable formula fields; no counter buttons.',
		'Descriptions are plain text with preserved line breaks; visibility follows source flags.',
		'Pages and one-off equipment are stock blocks; only source templates and property rows are custom.',
		'Active item bonuses are folded into formulas; template armor overrides remain inactive.',
		'D&D ability modifiers/proficiency use floor; original formulas retained in audit.',
		'No source images were present.'
	]
};
for (const [name, value] of Object.entries({
	'sheet.json': sheet,
	'library.json': definitions,
	'conversion.json': { metadata, formulaAudit }
})) {
	const file = new URL(name, output);
	await writeFile(
		file,
		await format(JSON.stringify(value), {
			...(await resolveConfig(file.pathname)),
			filepath: file.pathname
		})
	);
}
console.log(JSON.stringify(metadata, null, 2));
