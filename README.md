# ReactiveBlockBuilder (prototype)

A Svelte 5 + Tiptap experiment for an Obsidian-friendly character-sheet designer.

The document schema contains only **container**, **textBlock**, **formula**, and **image** nodes. Layout is ordinary CSS. Formula and image nodes are Svelte components mounted as Tiptap node views.

## Run

```sh
npm install
npm run dev
npm run check
npm run build
```

Open the demo, add blocks, edit text directly, select a block to edit its classes/attributes, change formulas and CSS, then export/import the document JSON.

## Architecture

- `src/lib/editor/nodes.ts`: Tiptap schema, dynamic Svelte node views.
- `src/lib/blocks/`: live Svelte formula and image components.
- `src/lib/formula/engine.ts`: copied from [ts_reactive_character_sheet_test](https://github.com/0biWanKenobi/ts_reactive_character_sheet_test), including math.js AST caching, recursive resolution, boolean comparisons, dice, dl and kh.
- `src/lib/sample.ts`: sample document, character fields and default scoped CSS.
- `src/routes/+page.svelte`: demo WYSIWYG editor, properties panel, JSON and CSS source panels.

The editor uses document JSON as its source of truth; the field values/formulas are a **separate shared reactive object**. Multiple formula nodes may reference the same field. Dice are only rolled on explicit action.

## Current limitations

- This is a browser/SvelteKit spike, not an Obsidian plugin yet.
- Drag-and-drop is ProseMirror's *document reordering*, not two-dimensional snap-to-grid placement or resizing.
- Only built-in registered block types are supported; custom reusable template definitions come later.
- The design/play toggle makes the same Tiptap document read-only. A lightweight standalone runtime renderer comes later.
- CSS is intentionally editable and injected into the demo page. The defaults are scoped to `.sheet-content`, but arbitrary user CSS is **not yet sandboxed**; untrusted styles must be isolated before enabling sharing.
- The demo keeps exported JSON/CSS in textareas; vault persistence, migrations, and asset resolution are future Obsidian integration work.
