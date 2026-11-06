# Defensive programming review

Reviewed: 2026-11-03, revision `f7e3934`.

## Scope and conclusion

The prototype's human-operated UI is the only supported entry point. This review
does not assume external API callers, arbitrary direct function calls, DevTools
state changes, or future storage adapters.

Ten findings below defend against states that the current callers already exclude
or repeat validation performed earlier in the same synchronous operation.
These are simplification opportunities, not ten user-visible bugs.

An important boundary: the UI includes editable Sheet JSON, Definition JSON, CSS,
and formula inputs. Humans can enter malformed data through those controls.
Checks on that input are not excessive merely because the application is a
prototype.

Only this report was added. Before snippets are focused source excerpts; after
snippets are proposed changes, not applied or separately tested implementations.
Source links and line numbers were refreshed against the current working tree on
2026-11-03; before snippets preserve the originally reviewed revision.

| #   | Finding                                            | Why the rejected state is unreachable                          |
| --- | -------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Fallbacks after single-block document transforms   | Those transforms map children without deleting them.           |
| 2   | Repeated custom-block root validation              | The UI has just checked the same root before these calls.      |
| 3   | Null checks on required modal-inspector props      | The parent mounts the inspector only with a block and editor.  |
| 4   | Negative child-index checks                        | A node is necessarily in the child list of its current parent. |
| 5   | Palette block-type validation                      | Both callers construct one of the supported block types.       |
| 6   | Play-mode check inside palette drag start          | Play makes the palette inert and disables dragging.            |
| 7   | Class-edit restriction inside the property handler | The restricted selections have no class input.                 |
| 8   | Roll handler rechecks whether rolling is available | Its button exists only for a rollable expression.              |
| 9   | Two checks rejecting boolean roll results          | The second check rejects exactly the same boolean.             |
| 10  | Missing-option check in dropdown selection         | Every current caller supplies a valid option index.            |

## 1. Fallbacks after transforms that preserve a single child

**Locations:** [leftSidebar.svelte:71](../src/routes/components/leftSidebar.svelte#L71),
[CustomBlockEditorModal.svelte:143](../src/lib/custom-blocks/CustomBlockEditorModal.svelte#L143),
[+page.svelte:81](../src/routes/+page.svelte#L81) and [line 109](../src/routes/+page.svelte#L109),
[model.ts:255](../src/lib/custom-blocks/model.ts#L255).

**UI path:** drag a palette block, create a definition from a container, or replace
that container with an instance. Each caller creates a document with exactly one
child before calling `expandDocument` or `collapseDocument`.

Both transforms preserve the document wrapper and map its children one for one.
Expanding a custom block either returns a node or throws; it never silently
removes that child. A missing result therefore has no corresponding human action.

Before, in the sidebar:

```ts
const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
if (expanded) startPaletteDrag(editor.view, event, expanded);
```

After:

```ts
const expanded = expandDocument({ type: 'doc', content: [block] }, library).content![0];
startPaletteDrag(editor.view, event, expanded);
```

The same reasoning removes `if (!expanded) return` in `replaceOriginal`,
`expandedTemplate ?? editedBlock.structure` in `startNewDefinition`, and
`?? structure` after `collapseDocument` in `createDefinition`.

The non-null assertion documents this particular transform invariant; it is not
a suggestion to assert away optional children on arbitrary imported JSON.
Keep errors for missing definitions and circular references.

## 2. Custom-block root validation repeats an immediately preceding check

**Locations:** [model.ts:244](../src/lib/custom-blocks/model.ts#L244) and [line 262](../src/lib/custom-blocks/model.ts#L262).

There are two instances of the same ownership problem:

- Creation: `startNewDefinition` checks that the selected node is a non-empty
  container, then synchronously passes its JSON to `createDefinition`, which
  checks the same condition again.
- Saving: the modal's `currentDraft` calls `currentStructure`, which rejects a
  missing, non-container, or empty root. It immediately calls `onSave`; the page
  calls `validateDefinition` before its first `await` and repeats that root check.

No human event can run between each pair of checks. Keep one check at the UI
boundary where the current document becomes a definition.

Before, in `validateDefinition`:

```ts
if (definition.structure.type !== 'container' || !definition.structure.content?.length) {
	throw new Error('A custom block must contain a non-empty root container');
}
const candidate: BlockLibrary = {
	get: (typeId) => (typeId === definition.typeId ? definition : library.get(typeId)),
	list: () => [...library.list().filter((item) => item.typeId !== definition.typeId), definition]
};
// Expansion checks both missing dependencies and recursive type references.
expandDocument({ type: 'doc', content: [makeInstance(definition)] }, candidate);
```

After:

```ts
const candidate: BlockLibrary = {
	get: (typeId) => (typeId === definition.typeId ? definition : library.get(typeId)),
	list: () => [...library.list().filter((item) => item.typeId !== definition.typeId), definition]
};
// The modal already checked the root. Check the candidate's reference graph.
expandDocument({ type: 'doc', content: [makeInstance(definition)] }, candidate);
```

Likewise, remove the opening root-condition block from `createDefinition` while
retaining the check in `startNewDefinition`.

This recommendation depends on the current call graph, not merely the TypeScript
types. Keep `currentStructure` validation: humans can change Definition JSON or
the preview. Keep dependency validation: excluding the current type from the
palette does not prevent indirect cycles through another definition.

## 3. The mounted modal inspector cannot have a missing editor or block

**Locations:** [modal-editor/Inspector.svelte:38](../src/lib/custom-blocks/modal-editor/Inspector.svelte#L38)
and [line 118](../src/lib/custom-blocks/modal-editor/Inspector.svelte#L118).

**UI path:** the modal mounts this inspector only inside
`{#if selected && editor}`. Its `block` and `editor` props are required and
non-nullable. Clearing the selection or editor removes the inspector; there is
no supported UI state with an interactive inspector and either prop absent.

Before, in `updateNestedValue`:

```ts
if (!editor) return false;
const node = editor.state.doc.nodeAt(leaf.pos);
if (!node || node.type.name !== leaf.type) return false;
const transaction = editor.state.tr;
```

After:

```ts
const node = editor.state.doc.nodeAt(leaf.pos);
if (!node || node.type.name !== leaf.type) return false;
const transaction = editor.state.tr;
```

Also remove the outer `if (block && editor)` around the Delete selected handler.
This finding concerns prop presence only; it does not establish that every
position-based node check can be removed.

## 4. A node cannot be absent from its current parent's children

**Locations:** [blockInteraction.ts:43](../src/lib/editor/blockInteraction.ts#L43),
[CustomBlockEditorModal.svelte:159](../src/lib/custom-blocks/CustomBlockEditorModal.svelte#L159).

**UI path:** pointer handling gets a DOM element, reads its current parent, then
looks up that element in the parent's `childNodes`. The code does not yield or
call application code between those steps. A human cannot detach the node in
the middle of this synchronous calculation.

Before, in `blockBoundary`:

```ts
const parent = element.parentNode;
if (!parent || !view.dom.contains(element)) return null;

const index = Array.prototype.indexOf.call(parent.childNodes, element) as number;
if (index < 0) return null;
```

After:

```ts
const parent = element.parentNode;
if (!parent || !view.dom.contains(element)) return null;

const index = Array.prototype.indexOf.call(parent.childNodes, element) as number;
```

Apply the same deletion after the `nested.parentNode` lookup in the modal.
Keep the editor-containment and DOM-to-document mapping checks: being a DOM
child does not guarantee that it maps to an editor block.

## 5. Palette drag start validates block types that its callers construct

**Location:** [blockDragPreview.ts:38](../src/lib/editor/blockDragPreview.ts#L38).

**UI path:** `startPaletteDrag` has two application callers: the sidebar and the
definition modal. Both receive blocks from `BlockPalette`. Stock tiles use the
fixed container/text/formula/image samples. Custom tiles explicitly construct a
`customBlock`, and expansion retains that outer type.

The JSON panels do not call this function with their parsed document. Editing a
custom definition's internals also cannot change the outer palette instance's
type. The broad `JSONContent` type permits cases the callers do not produce.

Before:

```ts
if (
	!canInsertFromPalette(view) ||
	!event.dataTransfer ||
	!content.type ||
	!blockTypes.has(content.type)
) {
	event.preventDefault();
	return;
}
```

After:

```ts
if (!canInsertFromPalette(view) || !event.dataTransfer) {
	event.preventDefault();
	return;
}
```

Remove the two content-shape checks. This does not extend to generic drop
handlers, which also receive native browser drops and text selections.

## 6. The sidebar's drag-start handler cannot run from Play mode

**Location:** [leftSidebar.svelte:61](../src/routes/components/leftSidebar.svelte#L61).

**UI path:** this handler is wired only to palette `dragstart` events. In Play,
the sidebar is `inert`, its containing side pane is also inert, and palette
tiles receive `draggable={false}`. Humans have no route to start that drag.

Before:

```ts
if (!editor || mode !== 'design') {
	event.preventDefault();
	onDragPaletteBlock({
		success: false,
		message: 'Editor is not initialized or mode is not Design'
	});
	return;
}
```

After:

```ts
if (!editor) {
	event.preventDefault();
	onDragPaletteBlock({
		success: false,
		message: 'Editor is not initialized'
	});
	return;
}
```

Only the mode branch is classified here. Keep Play handling on the live canvas:
the canvas remains reachable in Play, unlike the palette.

## 7. The property handler repeats the class input's visibility condition

**Location:** [inspector.svelte:69](../src/routes/components/inspector.svelte#L69).

**UI path:** `editAttribute('class', ...)` is called only by the CSS classes
input. That input is rendered only when the selected node is neither a custom
block nor inside one. The handler repeats the same restriction. Other inputs
call it with `field`, `src`, or `alt`.

Before:

```ts
if (!editor || !selected) return;
const node = editor.state.doc.nodeAt(selected.pos);
if (!node || node.type.name !== selected.type) return;
if (attribute === 'class' && (selected.type === 'customBlock' || selectedIsInsideCustomBlock()))
	return;
updateBlockAttribute(editor, selected.pos, attribute, value);
```

After:

```ts
if (!editor || !selected) return;
const node = editor.state.doc.nodeAt(selected.pos);
if (!node || node.type.name !== selected.type) return;
updateBlockAttribute(editor, selected.pos, attribute, value);
```

Keep the input's visibility condition. Keep `CustomBlockProtection`, which
also handles document changes from keyboard editing and dragging; it protects
more entry paths than this property input.

## 8. The Roll handler rechecks the condition that creates its button

**Location:** [FormulaBlock.svelte:15](../src/lib/blocks/FormulaBlock.svelte#L15).

**UI path:** `roll` is called only by the Roll button, rendered exclusively in
the `evaluated.value?.rollable` branch. Changing the formula to a non-rollable
expression removes that button. Rolling itself is synchronous and leaves the
formula unchanged.

Before:

```ts
function roll() {
	if (!evaluated.value?.rollable) return;
	try {
		lastRoll = executeRoll(evaluated.value.expression);
		rollError = '';
	} catch (error) {
		rollError = error instanceof Error ? error.message : String(error);
	}
}
```

```svelte
{:else if evaluated.value?.rollable}
  <button class="rbb-roll" type="button" onclick={roll}>🎲 Roll {attrs.field}</button>
```

After, pass the expression from the branch that already knows it exists:

```ts
function roll(expression: string) {
	try {
		lastRoll = executeRoll(expression);
		rollError = '';
	} catch (error) {
		rollError = error instanceof Error ? error.message : String(error);
	}
}
```

```svelte
{:else if evaluated.value?.rollable}
  {@const expression = evaluated.value.expression}
  <button class="rbb-roll" type="button" onclick={() => roll(expression)}>
    🎲 Roll {attrs.field}
  </button>
```

This removes the silent no-op path without a non-null assertion. Keep the catch:
a rollable expression can still fail during evaluation, for example with invalid
dice counts.

## 9. Boolean roll results are rejected twice

**Location:** [engine.ts:252](../src/lib/formula/engine.ts#L252).

**UI path:** a human can enter a dice expression that returns a boolean, such as
`1d6 > 3`, then click Roll. Rejecting that result is real behavior. The excess is
having two checks for it.

`baseValue` returns booleans unchanged and otherwise returns a number or throws.
The second check therefore already rejects a boolean with the same message.

Before:

```ts
const result: unknown = compiled(expression).evaluate(scope);
if (typeof result === 'boolean') throw Error('Roll expressions must produce a numeric result');
const total = baseValue(result);
if (typeof total !== 'number') throw Error('Roll expressions must produce a numeric result');
return { total, dice: diceLog };
```

After:

```ts
const result: unknown = compiled(expression).evaluate(scope);
const total = baseValue(result);
if (typeof total !== 'number') throw Error('Roll expressions must produce a numeric result');
return { total, dice: diceLog };
```

The user gets the same error. Numeric and non-finite-result handling is unchanged.

## 10. Dropdown selection cannot receive a missing option

**Location:** [Dropdown.svelte:48](../src/lib/components/Dropdown.svelte#L48).

**UI path:** there are two dropdowns: three conversion choices and five theme
stylesheets. Neither changes its option count. Pointer selection passes the
index from the rendered `each` block. Keyboard selection uses `activeIndex`,
initialized to a valid index and moved by bounded or wrapping operations.
Theme edits update labels, not the option list's size or identities.

Before:

```ts
function choose(index: number) {
	const option = options[index];
	if (!option) return;
	value = option.value;
	close();
	trigger.focus({ preventScroll: true });
}
```

After:

```ts
function choose(index: number) {
	value = options[index].value;
	close();
	trigger.focus({ preventScroll: true });
}
```

No current human interaction supplies an out-of-range index. Reconsider this
assumption if the component later receives asynchronously shrinking option lists.

## Checks with a real purpose

These were reviewed and excluded from the removal recommendations:

- **JSON parsing and shape validation.** Humans can type invalid JSON, unknown
  nodes, non-string field formulas, and missing custom-block references directly
  into the source panels. TypeScript annotations do not constrain parsed JSON.
- **Missing custom definitions and dependency cycles.** The UI can delete a
  referenced definition. A definition can reference another definition that
  eventually refers back to it, despite the palette excluding direct self-use.
- **Formula validation.** Inputs such as `STR +`, `1 / 0`, `roll(0, 6)`, and
  `dl(1d6, 2)` require error handling. Field formulas can also contain unknown
  references and cycles. Formula length and dice limits bound user-entered work.
- **CSS formatting's stale-result check.** `format` awaits dynamic imports and
  formatting. A human can continue editing meanwhile; `styles[section] === css`
  prevents the older result from overwriting newer text. Keep this check.
- **Lifecycle checks in effects and initialization.** Effects can run before an
  editor or style element exists. Mounting order is different from a human
  clicking an already rendered control.
- **Native drag/drop classification.** Browser event handlers receive more than
  palette blocks: external drags, text selections, pointer exits, and drops at
  invalid positions are real input paths.
- **Custom-block structural protection.** Hiding a property input does not stop
  structural changes through the canvas's keyboard and drag interactions.
- **Storage failures and missing saved styles.** Browser storage can fail, and
  an unsaved stylesheet legitimately has no stored value. Empty saved CSS is
  also intentional, so its nullish fallback must not become a truthy fallback.

The current storage adapter performs synchronous `localStorage` operations inside
async methods. An `await` alone is not evidence that a human can interleave
another click before that operation completes. Conversely, the CSS formatter
has genuinely asynchronous work. Concurrency should be assessed at that level,
rather than inferred from every `async` function.

## Verification and limits

Reviewed application source and current callers across the route, palettes,
inspectors, custom-block model, editor interactions, formula engine, source
panels, theme editor, and shared controls.

Baseline command: `bun test` — **16 passed, 0 failed**, across three test files
with 90 assertions. These tests cover the unchanged application, not the proposed
edits. Browser behavior tests were not run; reachability conclusions above come
from tracing the current UI bindings and synchronous call paths.

The suggested removals are scoped to this prototype. Recheck their assumptions
when adding new UI callers, dynamically changing dropdown options, or externally
callable model functions.
