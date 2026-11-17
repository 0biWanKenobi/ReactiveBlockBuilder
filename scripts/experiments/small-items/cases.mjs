import { createSmokeBallBundle } from '../../../examples/smoke-ball/bundle.mjs';

export async function exportCases() {
	const smoke = await createSmokeBallBundle();
	const make = (count) => ({
		version: 1,
		themeId: 'default',
		fields: Object.fromEntries(
			Array.from({ length: count }, (_, i) => {
				const id = 'CELL_' + i;
				return [id, { id, formula: i ? `{CELL_${i - 1}} + 1` : '1' }];
			})
		),
		document: {
			type: 'doc',
			content: [
				{
					type: 'textBlock',
					attrs: { nodeId: 'ledger', class: 'sheet-note' },
					content: [{ type: 'text', text: 'Formula lookup ledger: intentionally simple canvas' }]
				}
			]
		}
	});
	return [
		{ name: 'small-8', sheet: make(8), storage: {} },
		{ name: 'smoke-238', sheet: smoke.sheet, storage: smoke.storage },
		{ name: 'ledger-2048', sheet: make(2048), storage: {} }
	];
}

export function dragCase(count, layout) {
	return {
		version: 1,
		themeId: 'default',
		fields: { VALUE: { id: 'VALUE', formula: '1' } },
		document: {
			type: 'doc',
			content: [
				{
					type: 'container',
					attrs: { nodeId: 'drag-list', class: `drag-study drag-${layout}` },
					content: Array.from({ length: count }, (_, i) => ({
						type: 'textBlock',
						attrs: { nodeId: `card-${i}`, class: 'drag-card' },
						content: [{ type: 'text', text: `Item ${i + 1}` }]
					}))
				}
			]
		}
	};
}

export const dragCSS = `.sheet-content .sheet-document { padding: 12px; }
.drag-study { padding: 18px; }
.drag-list { display: flex; flex-direction: column; gap: 12px; }
.drag-grid { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 12px; }
.drag-card { display: block; padding: 8px; min-height: 32px; border: 1px solid #bbb; background: white; }`;
