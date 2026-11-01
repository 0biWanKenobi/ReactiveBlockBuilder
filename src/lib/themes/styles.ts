import type { SheetNodeType } from '../editor/nodes';

export type StockBlockType = Exclude<SheetNodeType, 'customBlock'>;
export type ThemeStylesheet = 'base' | StockBlockType;

/** Full editable defaults, shared by the canvas and definition preview. */
export const defaultBaseCSS = `
/* Shared sheet appearance in the canvas and definition preview. */
.sheet-content { background: #fdfaf4; border-radius: inherit; color: #312d2a; font-family: Inter, system-ui, -apple-system, sans-serif; }
.sheet-content, .sheet-content * { box-sizing: border-box; }
/* Keep the sheet gutters inside the document so they receive drag events. */
.sheet-content .sheet-document { padding: 28px; }
@media (max-width: 620px) {
  .sheet-content .sheet-document { padding: 15px; }
}
`;

export const stockBlockStyles = {
	container: {
		label: 'Container',
		css: `
.sheet-content .sheet-header {
  margin-bottom: 24px;
  border-bottom: 1px solid #c3ad8f;
  padding-bottom: 18px;
}
.sheet-content .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
.sheet-content .stat-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px solid #cab89d; border-radius: 12px; background: #fffaf1; padding: 18px 8px; min-height: 125px; }
.sheet-content .sheet-footer { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
@media (max-width: 720px) {
  .sheet-content .stats-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
`
	},
	textBlock: {
		label: 'Text',
		css: `
.sheet-content .sheet-title { display: block; font-size: 1.45rem; font-weight: 750; letter-spacing: .08em; }
.sheet-content .sheet-subtitle { display: block; color: #786958; font-size: .9rem; margin-top: 4px; }
.sheet-content .stat-label { font-size: .68rem; letter-spacing: .12em; color: #795c46; font-weight: bold; }
.sheet-content .sheet-note { font-size: .85rem; color: #675e56; }
`
	},
	formula: {
		label: 'Formula',
		css: `
.sheet-content .rbb-formula { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sheet-content .rbb-formula-error { color: #bb3434; font-size: .75rem; }
.sheet-content .rbb-roll { border: 1px solid #d4c7b7; border-radius: 7px; background: #fdfaf5; color: #5e4e3f; padding: 8px 11px; font: inherit; font-size: .76rem; cursor: pointer; }
.sheet-content .rbb-roll:enabled:hover { filter: brightness(.97); }
.sheet-content .rbb-roll:focus-visible { outline: 2px solid #987451; outline-offset: 2px; }
.sheet-content .rbb-roll:disabled { opacity: .5; cursor: not-allowed; }
.sheet-content .rbb-roll-total { color: #655028; }
.sheet-content .rbb-roll-detail { font-size: .68rem; color: #6f6559; }
.sheet-content .stat-number { font-size: 1.4rem; font-weight: 750; }
.sheet-content .stat-mod { font-size: .85rem; color: #86531b; }
`
	},
	image: {
		label: 'Image',
		css: `
.sheet-content .rbb-image { display: block; max-width: 100%; height: auto; }
.sheet-content .rbb-empty-image { display: inline-block; border: 1px dashed #bca88c; padding: 16px; color: #7c7165; font-size: .8rem; }
.sheet-content .sheet-image img { max-width: 100%; border-radius: 8px; }
`
	}
} satisfies Record<StockBlockType, { label: string; css: string }>;

export const defaultThemeStylesheets = {
	base: defaultBaseCSS,
	container: stockBlockStyles.container.css,
	textBlock: stockBlockStyles.textBlock.css,
	formula: stockBlockStyles.formula.css,
	image: stockBlockStyles.image.css
};

export type ThemeStylesheets = Record<ThemeStylesheet, string>;
export const themeStylesheetIds = Object.keys(defaultThemeStylesheets) as ThemeStylesheet[];

/** Shared CSS follows block styles to allow theme-wide overrides. */
export function composeThemeCSS(styles: ThemeStylesheets): string {
	return [styles.container, styles.textBlock, styles.formula, styles.image, styles.base].join('\n');
}
