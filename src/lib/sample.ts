import { composeThemeCSS, defaultThemeStylesheets } from './themes/styles';
import type { JSONContent } from '@tiptap/core';
import type { Sheet } from './formula/engine';

export const initialFields: Sheet = {
	STR: { id: 'STR', formula: '16' },
	DEX: { id: 'DEX', formula: '12' },
	PROF: { id: 'PROF', formula: '2' },
	STR_MOD: { id: 'STR_MOD', formula: 'floor(({STR} - 10) / 2)' },
	DEX_MOD: { id: 'DEX_MOD', formula: 'floor(({DEX} - 10) / 2)' },
	ATTACK: { id: 'ATTACK', formula: '{STR_MOD} + {PROF}' },
	DAMAGE: { id: 'DAMAGE', formula: 'kh(4d6, 3) + {STR_MOD}' },
	BOOLEAN: { id: 'BOOLEAN', formula: '{STR} >= 16' }
};

const text = (value: string, classes = 'sheet-text'): JSONContent => ({
	type: 'textBlock',
	attrs: { class: classes },
	content: [{ type: 'text', text: value }]
});
const formula = (field: string, classes = 'sheet-formula'): JSONContent => ({
	type: 'formula',
	attrs: { field, class: classes }
});
const container = (classes: string, children: JSONContent[]): JSONContent => ({
	type: 'container',
	attrs: { class: classes },
	content: children
});

export const sampleDocument: JSONContent = {
	type: 'doc',
	content: [
		container('sheet-header', [
			text('THE WANDERING ARTIFICER', 'sheet-title'),
			text('A reactive character sheet built from nested blocks', 'sheet-subtitle')
		]),
		container('stats-grid', [
			container('stat-card', [
				text('STRENGTH', 'stat-label'),
				formula('STR', 'stat-number'),
				formula('STR_MOD', 'stat-mod')
			]),
			container('stat-card', [
				text('DEXTERITY', 'stat-label'),
				formula('DEX', 'stat-number'),
				formula('DEX_MOD', 'stat-mod')
			]),
			container('stat-card', [text('ATTACK', 'stat-label'), formula('ATTACK', 'stat-number')]),
			container('stat-card', [text('DAMAGE', 'stat-label'), formula('DAMAGE', 'stat-number')])
		]),
		container('sheet-footer', [
			text(
				'Try editing STR from the formula panel: modifiers and attacks update automatically.',
				'sheet-note'
			),
			{
				type: 'image',
				attrs: {
					src: 'https://placehold.co/480x120/png?text=Image+block',
					alt: 'Example image block',
					class: 'sheet-image'
				}
			}
		])
	]
};

/** Complete default theme for consumers that inject a single stylesheet. */
export const defaultCSS = composeThemeCSS(defaultThemeStylesheets);
