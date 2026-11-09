# Compact custom NodeViews experiment

Branch: `simplify-custom-nodes`.
Baseline: `dev` at `403b569fcd18914d64d279f38a826db092a4ba77`.
Compared on 2026-11-09.

The compact representation works inside Tiptap, including inline text edits.
It simplifies document loading, saving, and definition updates, but does not
produce a meaningful overall reduction in code size. Complexity moves from
document conversion and structural protection into rendering and native editing.

## Implementation

- `customBlock` is a leaf atom containing `typeId`, identity, and `values`.
  Live `editor.getJSON()` is compact, rather than only the saved JSON.
- `CustomBlockView.svelte` renders the referenced definition using the existing
  formula and image components. Text leaves use `contenteditable="plaintext-only"`;
  the outer NodeView uses `contenteditable="false"` and has no `contentDOM`.
- Native input and composition-end events explicitly write overrides through
  Tiptap attribute transactions. `contenteditable` alone does not persist edits.
- `resolveInstance` retains the existing defaults/nested-override resolution
  algorithm, but its tree is exclusively a rendering projection.
- `prepareDocument` validates references and removes redundant/obsolete overrides
  at the import/export boundary. It does not diff edited child trees.
- Inspectors share `InstanceFields.svelte`, editing overrides directly.
- Library changes update the Svelte projection. Saving a definition no longer
  replaces the whole editor document with `setContent`.
- `expandDocument`, `collapseDocument`, and `CustomBlockProtection` are removed.
  Custom-block layout cannot be edited through the sheet document because its
  internal layout is absent from that document.

## Size

Scope: the union of changed, added, and deleted production files under `src`.
Tests, tooling, this report, generated output, and unchanged files are excluded.
Full-file counts include templates, styles, comments, and blank lines. The
formatted comparison applies the same repository Prettier configuration to
both revisions, avoiding an advantage from different line wrapping.

| Metric | Baseline | Experiment | Change |
| --- | ---: | ---: | ---: |
| Full-file lines, as stored | 2,775 | 2,801 | +26 (+0.9%) |
| Full-file lines, identical formatting | 2,785 | 2,801 | +16 (+0.6%) |
| Nonblank TS/script lines, identical formatting | 1,549 | 1,504 | -45 (-2.9%) |
| Source bytes, LF and identical formatting | 78,819 | 79,231 | +412 (+0.5%) |
| TS/script branch sites | 306 | 262 | -44 (-14.4%) |

Branch sites count `if`, ternaries, loops, switch cases, catches, `&&`, `||`,
and `??` through the TypeScript parser. They exclude Svelte template branches
and are a descriptive indicator, not a formal cyclomatic/cognitive complexity
score or a measure of editing correctness.

The three new view/field files total 240 lines. Existing files lose 214 lines
net, including the 59-line structural-protection extension. Thus removing the
two document converters does not eliminate the work of resolving definitions
or managing editable fields.

Reproduce against the fixed baseline, including uncommitted source changes:

```powershell
bun scripts/compare-custom-nodes.mjs
```

The command prints per-file and aggregate JSON measurements. An optional first
argument selects a different baseline commit.

## Verification

- Baseline and experiment: `bun test`, 17 passing regression scenarios and
  94 assertions. Model tests retain their defaults, nesting, conversion, and
  definition-evolution scenarios; they now inspect the rendering projection and
  compact overrides instead of the removed document-conversion functions.
- `bun run check`: zero errors or warnings.
- ESLint passes on changed production files. Prettier passes on the added and
  changed production files and new tooling/browser regression.
- `bunx vite build`, followed by `bun run prepack`: successful production build,
  package generation, and publint. Existing large-chunk/adapter notices remain.
- Browser checks ran through the MCP on port 7345 in the embedded browser,
  against the application on port 5173. Existing browser scripts were adapted
  in a temporary runner to use the shared page instead of launching Chromium;
  URLs and storage isolation were adjusted, while their assertions were kept.
- Existing custom-block suite passes, including its text-span and container
  context-menu checks, missing-reference/invalid-import atomicity, CSS isolation,
  nested overrides, layout evolution, instance deletion, and nested navigation.
- Existing ancestor-handle/drag, play-mode, dropdown, and stock-theme suites pass.
- New `scripts/test-compact-nodeviews.mjs` passes: compact live JSON and atom size,
  typing in the middle of text without losing the caret, native per-field undo
  updating JSON, removing overrides restored to defaults, formula/image/nested
  inspector edits, wrapper/root classes, edit/drag/play locking, and retained
  text DOM identity across a definition save.
- The existing side-pane suite fails its exact viewport-width assertion in this
  embedded Windows browser: expected 1,394px, actual 1,379px. The same failure was
  reproduced against a clean copy of the baseline commit on port 5189; its 15px
  scrollbar assumption is unrelated to this change. That suite is not claimed
  as passing.

## Tradeoffs and remaining work

- Each text field is an independent browser editing host. Text selection,
  keyboard navigation, and undo across multiple fields are no longer managed
  as one ProseMirror text document. The new regression verifies native undo
  within a field, not unified undo across fields, inspector edits, and layout.
- Formula/image editing selects the enclosing custom block and presents its
  fields in the inspector. Internal leaves have no ProseMirror positions.
- The experiment does not provide a rendered standalone HTML export for custom
  blocks. Its schema serializer emits the compact reference/values wrapper;
  `getHTML()` therefore lacks the definition's rendered children. The app's JSON
  import/export is covered. Adding full HTML export would require more code.
- Saved compact sheets and compact nested definitions keep their existing data
  format. Importing an expanded custom-block tree is explicitly rejected.
- Composition-aware event handlers are present, but real IME, mobile editing,
  cross-field clipboard/selection, and assistive-technology behavior need further
  testing before treating this as a production replacement.

For code reduction alone, keep the baseline approach. This branch is useful if
a compact canonical editor document and definition updates without document
replacement are more valuable than native editing across block internals.
