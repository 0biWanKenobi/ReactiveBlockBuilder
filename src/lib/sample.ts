import type { JSONContent } from '@tiptap/core';
import type { Sheet } from './formula/engine.js';

export const initialFields: Sheet = {
  STR: { id: 'STR', formula: '16' },
  DEX: { id: 'DEX', formula: '12' },
  PROF: { id: 'PROF', formula: '2' },
  STR_MOD: { id: 'STR_MOD', formula: 'floor((STR - 10) / 2)' },
  DEX_MOD: { id: 'DEX_MOD', formula: 'floor((DEX - 10) / 2)' },
  ATTACK: { id: 'ATTACK', formula: 'STR_MOD + PROF' },
  DAMAGE: { id: 'DAMAGE', formula: 'kh(4d6, 3) + STR_MOD' },
  BOOLEAN: { id: 'BOOLEAN', formula: 'STR >= 16' }
};

const text = (value: string, classes = 'sheet-text'): JSONContent => ({
  type: 'textBlock', attrs: { class: classes }, content: [{ type: 'text', text: value }]
});
const formula = (field: string, classes = 'sheet-formula'): JSONContent => ({
  type: 'formula', attrs: { field, class: classes }
});
const container = (classes: string, children: JSONContent[]): JSONContent => ({
  type: 'container', attrs: { class: classes }, content: children
});

export const sampleDocument: JSONContent = {
  type: 'doc',
  content: [
    container('sheet-header', [
      text('THE WANDERING ARTIFICER', 'sheet-title'),
      text('A reactive character sheet built from nested blocks', 'sheet-subtitle')
    ]),
    container('stats-grid', [
      container('stat-card', [text('STRENGTH', 'stat-label'), formula('STR', 'stat-number'), formula('STR_MOD', 'stat-mod')]),
      container('stat-card', [text('DEXTERITY', 'stat-label'), formula('DEX', 'stat-number'), formula('DEX_MOD', 'stat-mod')]),
      container('stat-card', [text('ATTACK', 'stat-label'), formula('ATTACK', 'stat-number')]),
      container('stat-card', [text('DAMAGE', 'stat-label'), formula('DAMAGE', 'stat-number')])
    ]),
    container('sheet-footer', [
      text('Try editing STR from the formula panel: modifiers and attacks update automatically.', 'sheet-note'),
      { type: 'image', attrs: { src: 'https://placehold.co/480x120/png?text=Image+block', alt: 'Example image block', class: 'sheet-image' } }
    ])
  ]
};

export const defaultCSS = `
/* All selectors are scoped to the sheet preview. */
.sheet-content .sheet-header {
  margin-bottom: 24px;
  border-bottom: 1px solid #c3ad8f;
  padding-bottom: 18px;
}
.sheet-content .sheet-title { font-size: 1.45rem; font-weight: 750; letter-spacing: .08em; }
.sheet-content .sheet-subtitle { color: #786958; font-size: .9rem; margin-top: 4px; }
.sheet-content .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
.sheet-content .stat-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px solid #cab89d; border-radius: 12px; background: #fffaf1; padding: 18px 8px; min-height: 125px; }
.sheet-content .stat-label { font-size: .68rem; letter-spacing: .12em; color: #795c46; font-weight: bold; }
.sheet-content .stat-number { font-size: 1.4rem; font-weight: 750; }
.sheet-content .stat-mod { font-size: .85rem; color: #86531b; }
.sheet-content .sheet-footer { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.sheet-content .sheet-note { font-size: .85rem; color: #675e56; }
.sheet-content .sheet-image img { max-width: 100%; border-radius: 8px; }
@media (max-width: 720px) {
  .sheet-content .stats-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
`;
