<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from '../lib/editor/CodeEditor.svelte';
  import BlockPalette from '../lib/editor/BlockPalette.svelte';
  import CustomBlockEditorModal from '../lib/custom-blocks/CustomBlockEditorModal.svelte';
  import { CustomBlockLibrary } from '../lib/custom-blocks/library.svelte.js';
  import { CustomBlockRepository, DEFAULT_THEME } from '../lib/custom-blocks/repository.js';
  import { LocalStorageAdapter } from '../lib/storage/StorageAdapter.js';
  import { createDefinition, makeInstance, expandDocument, collapseDocument, captureInitialValues } from '../lib/custom-blocks/model.js';
  import type { CustomBlockDefinition } from '../lib/custom-blocks/types.js';
  import { blockBoundary } from '../lib/editor/blockInteraction.js';
  import { Editor, type JSONContent } from '@tiptap/core';
  import { NodeSelection } from '@tiptap/pm/state';
  import { startPaletteDrag, endPaletteDrag } from '../lib/editor/blockDragPreview.js';
  import { setBlockDragMode } from '../lib/editor/blockInteraction.js';
  import {
    createSheetExtensions, allowedNodeTypes,
    initialFields, sampleDocument, defaultCSS, validateId
  } from '../lib/index.js';
  import type { Sheet, SheetNodeType } from '../lib/index.js';

  type SelectedBlock = {
    type: SheetNodeType;
    pos: number;
    attrs: Record<string, unknown>;
  };

  type SavedSheet = {
    version: 1;
    document: JSONContent;
    themeId: string;
    fields: Sheet;
  };

  let canvas: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  let selected = $state<SelectedBlock | null>(null);
  let mode = $state<'design' | 'play'>('design');
  let designTool = $state<'edit' | 'drag'>('edit');
  let fields = $state<Sheet>(structuredClone(initialFields));
  const library = new CustomBlockLibrary();
  const repository = new CustomBlockRepository(new LocalStorageAdapter());
  let css = $state(defaultCSS);
  let savedCSS = $state(defaultCSS);
  let blockCSS = $state<Record<string, string>>({});
  let editedBlock = $state<CustomBlockDefinition | null>(null);
  let pendingConversion = $state<number | null>(null);
  let pendingOriginalValues = $state<Record<string, string | { src: string; alt: string }>>({});
  let contextPosition = $state<number | null>(null);
  let contextCoords = $state({x: 0, y: 0});
  let saveBehavior = $state<'ask' | 'replace' | 'keep'>('ask');
  let conversionPrompt = $state<{ pos: number; typeId: string } | null>(null);
  let rememberChoice = $state(false);
  let jsonSource = $state(JSON.stringify({
    version: 1, themeId: DEFAULT_THEME, document: sampleDocument, fields: initialFields
  }, null, 2));
  let message = $state('');
  let newField = $state('');
  let newExpression = $state('1');
  let fieldError = $state('');
  let styleElement: HTMLStyleElement | null = null;

  function synchronizeSelection(current: Editor) {
    const selection = current.state.selection;
    const found = selection instanceof NodeSelection
      ? { node: selection.node, pos: selection.from }
      : selection.$from.depth > 0
        ? {
            node: selection.$from.parent,
            pos: selection.$from.before(selection.$from.depth)
          }
        : null;

    if (found && allowedNodeTypes.includes(found.node.type.name as SheetNodeType)) {
      selected = {
        type: found.node.type.name as SheetNodeType,
        attrs: { ...found.node.attrs },
        pos: found.pos
      };
    } else {
      selected = null;
    }
  }

  onMount(() => {
    styleElement = document.createElement('style');
    styleElement.dataset.reactiveBlockBuilder = 'sample';
    styleElement.textContent = css;
    document.head.appendChild(styleElement);

    void (async () => {
      try {
        library.replace(await repository.list());
        const stored = await repository.readBaseCSS();
        if (stored !== null) { css = stored; savedCSS = stored; }
        else await repository.writeBaseCSS(defaultCSS);
        await reloadBlockStyles();
      } catch (error) {
        message = `Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    })();

    const instance = new Editor({
      element: canvas,
      extensions: createSheetExtensions(fields),
      content: sampleDocument,
      editable: true,
      autofocus: false,
      editorProps: {
        attributes: { 'aria-label': 'Character sheet block editor' }
      },
      onSelectionUpdate: ({ editor }) => synchronizeSelection(editor),
      onTransaction: ({ editor }) => synchronizeSelection(editor)
    });
    editor = instance;
    synchronizeSelection(instance);

    return () => {
      instance.destroy();
      styleElement?.remove();
      styleElement = null;
      editor = null;
    };
  });

  $effect(() => {
    if (styleElement) styleElement.textContent = css + '\n' +
      Object.values(blockCSS).join('\n');
  });

  async function reloadBlockStyles() {
    const styles: Record<string, string> = {};
    for (const definition of library.list()) {
      styles[definition.typeId] = await repository.readBlockCSS(definition.typeId);
    }
    blockCSS = styles;
  }

  async function saveThemeCSS() {
    await repository.writeBaseCSS(css);
    savedCSS = css;
    message = 'Theme CSS saved';
  }

  function discardThemeCSS() {
    css = savedCSS;
    message = 'Theme CSS discarded';
  }

  function startNewDefinition(pos: number) {
    message = `startNewDefinition called at ${pos}`;
    if (!editor) { message = 'No editor'; return; }
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'container' || !node.childCount) { message = `Invalid candidate: ${node?.type.name} children=${node?.childCount}`; return; }
    const name = String(node.attrs.class ?? '').trim().split(/\s+/)[0] || 'Custom block';
    try {
      editedBlock = createDefinition(name, node.toJSON(), library);
      pendingOriginalValues = captureInitialValues(editedBlock.structure, node.toJSON());
      pendingConversion = pos;
      message = `Created draft ${editedBlock.typeId}`;
    } catch (error) {
      message = `Custom block creation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function conversionChoice(replace: boolean) {
    if (!conversionPrompt) return;
    if (rememberChoice) saveBehavior = replace ? 'replace' : 'keep';
    if (replace) replaceOriginal(conversionPrompt.pos, conversionPrompt.typeId);
    conversionPrompt = null;
    pendingOriginalValues = {};
    rememberChoice = false;
  }

  function replaceOriginal(pos: number, typeId: string) {
    if (!editor) return;
    const definition = library.get(typeId);
    if (!definition) return;
    const original = editor.state.doc.nodeAt(pos);
    if (!original || original.type.name !== 'container') return;
    const compact = makeInstance(definition);
    compact.attrs = { ...compact.attrs, values: pendingOriginalValues };
    const expanded = expandDocument({
      type: 'doc', content: [compact]
    }, library).content?.[0];
    if (!expanded) return;
    const replacement = editor.state.schema.nodeFromJSON(expanded);
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + original.nodeSize, replacement));
  }

  async function deleteDefinition(definition: CustomBlockDefinition) {
    if (!window.confirm(`Delete "${definition.name}"? Sheets and custom blocks that reference it will fail to import.`)) return;
    try {
      await repository.delete(definition.typeId);
      library.remove(definition.typeId);
      await reloadBlockStyles();
      message = `Deleted custom block: ${definition.name}`;
    } catch (error) {
      message = `Delete failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function saveDefinition(definition: CustomBlockDefinition, blockStyle: string) {
    try {
      // Capture changes against the old definition before it is replaced.
      const compact = editor ? collapseDocument(editor.getJSON(), library) : null;
      await repository.save(definition);
      await repository.writeBlockCSS(definition.typeId, blockStyle);
      library.upsert(definition);
      if (editor && compact) {
        editor.commands.setContent(expandDocument(compact, library));
      }
      await reloadBlockStyles();
      editedBlock = null;
      if (pendingConversion !== null) {
        if (saveBehavior === 'ask') {
          conversionPrompt = { pos: pendingConversion, typeId: definition.typeId };
        } else if (saveBehavior === 'replace') {
          replaceOriginal(pendingConversion, definition.typeId);
        }
        pendingConversion = null;
      }
      message = `Saved custom block: ${definition.name}`;
    } catch (error) {
      message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function contextMenu(event: MouseEvent) {
    if (!editor || mode !== 'design') return;
    const target = event.target instanceof Element
      ? event.target.closest('section[data-sheet-container]') : null;
    if (!target) { contextPosition = null; return; }
    const boundary = blockBoundary(editor.view, target);
    const node = boundary && editor.state.doc.nodeAt(boundary.from);
    if (!boundary || !node?.childCount) return;
    event.preventDefault();
    contextPosition = boundary.from;
    contextCoords = { x: event.clientX, y: event.clientY };
  }

  $effect(() => {
    if (!editor) return;
    setBlockDragMode(editor.view, mode === 'design' && designTool === 'drag');
    editor.setEditable(mode === 'design');
  });

  function insert(block: JSONContent) {
    if (!editor) return;
    mode = 'design';
    try {
      const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
      if (!expanded) return;
      editor.chain().focus().insertContent(expanded).run();
      message = `Added ${block.type} block`;
    } catch (error) {
      message = `Cannot insert block: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function dragPaletteBlock(event: DragEvent, block: JSONContent) {
    if (!editor || mode !== 'design' || designTool !== 'drag') {
      event.preventDefault();
      return;
    }
    try {
      const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
      if (expanded) startPaletteDrag(editor.view, event, expanded);
    } catch (error) {
      event.preventDefault();
      message = `Cannot drag block: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function finishPaletteDrag() {
    if (editor) endPaletteDrag(editor.view);
  }

  function editAttribute(attribute: string, value: string) {
    if (!editor || !selected) return;
    const node = editor.state.doc.nodeAt(selected.pos);
    if (!node || node.type.name !== selected.type) return;
    if (attribute === 'class' && selectedIsInsideCustomBlock()) return;
    // Do not call editor.focus(): doing so would steal focus from the property input.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(
      selected.pos, undefined, { ...node.attrs, [attribute]: value }
    ));
  }

  function selectedIsInsideCustomBlock() {
    if (!editor || !selected) return false;
    const resolved = editor.state.doc.resolve(selected.pos);
    for (let depth = 1; depth <= resolved.depth; depth++) {
      if (resolved.node(depth).type.name === 'customBlock') return true;
    }
    return editor.state.doc.nodeAt(selected.pos)?.type.name === 'customBlock';
  }

  function selectContainer() {
    if (!editor) return;
    const from = editor.state.selection.$from;
    for (let depth = from.depth; depth > 0; depth--) {
      if (from.node(depth).type.name === 'container') {
        editor.commands.setNodeSelection(from.before(depth));
        return;
      }
    }
    message = 'No parent container at the current cursor';
  }

  function removeSelected() {
    if (!editor || !selected) return;
    const node = editor.state.doc.nodeAt(selected.pos);
    if (!node) return;
    editor.commands.deleteRange({ from: selected.pos, to: selected.pos + node.nodeSize });
    selected = null;
  }

  function addField() {
    const id = newField.trim().toUpperCase();
    const invalid = validateId(id);
    if (invalid) { fieldError = invalid; return; }
    if (Object.hasOwn(fields, id)) { fieldError = 'Field already exists'; return; }
    fields[id] = { id, formula: newExpression };
    newField = '';
    newExpression = '1';
    fieldError = '';
  }

  function formatJSON() {
    try {
      jsonSource = JSON.stringify(JSON.parse(jsonSource), null, 2) + '\n';
      message = 'JSON formatted';
    } catch (error) {
      message = `Cannot format JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function formatCSS() {
    try {
      // Lazy-load Prettier only when the format action is requested.
      const [prettier, postcss] = await Promise.all([
        import('prettier/standalone'),
        import('prettier/plugins/postcss')
      ]);
      css = await prettier.format(css, {
        parser: 'css',
        plugins: [postcss],
        tabWidth: 2
      });
      message = 'CSS formatted';
    } catch (error) {
      message = `Cannot format CSS: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function exportSheet() {
    if (!editor) return;
    const saved: SavedSheet = {
      version: 1,
      themeId: DEFAULT_THEME,
      document: collapseDocument(editor.getJSON(), library),
      fields: structuredClone($state.snapshot(fields))
    };
    jsonSource = JSON.stringify(saved, null, 2);
    message = 'Current sheet serialized below';
  }

  function validateNode(node: JSONContent): void {
    const type = node.type;
    if (!type || !['doc', 'text', ...allowedNodeTypes].includes(type)) {
      throw new Error(`Unsupported node: ${type ?? '(missing)'}`);
    }
    if (type === 'text' && typeof node.text !== 'string') {
      throw new Error('Text node is missing text');
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error('Invalid node children');
      for (const child of node.content) validateNode(child);
    }
  }

  function importSheet() {
    if (!editor) return;
    try {
      const imported: SavedSheet = JSON.parse(jsonSource);
      if (imported.version !== 1 || imported.document?.type !== 'doc' ||
          imported.themeId !== DEFAULT_THEME ||
          !imported.fields || typeof imported.fields !== 'object' || Array.isArray(imported.fields)) {
        throw new Error('Expected version 1 sheet with document, fields and default themeId');
      }
      validateNode(imported.document);
      const expanded = expandDocument(imported.document, library);
      // Preserve the reactive proxy: existing node views hold a reference to it.
      for (const key of Object.keys(fields)) delete fields[key];
      for (const [key, value] of Object.entries(imported.fields)) {
        if (validateId(key) || !value || typeof value.formula !== 'string') {
          throw new Error(`Invalid formula field ${key}`);
        }
        fields[key] = { id: key, formula: value.formula };
      }
      editor.commands.setContent(expanded);
      message = 'Sheet loaded';
    } catch (error) {
      message = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
</script>

<svelte:head>
  <title>Reactive Block Builder — prototype</title>
  <meta name="description" content="Svelte 5 and Tiptap character sheet WYSIWYG prototype" />
</svelte:head>

<div class="workspace" class:playing={mode === 'play'}>
  <header class="topbar">
    <div>
      <div class="eyebrow">SVELTE 5 × TIPTAP · PROTOTYPE</div>
      <h1>Reactive Block Builder</h1>
      <p>Build a nested character sheet with your own CSS and reactive formulas.</p>
    </div>
    <div class="mode-switch" role="group" aria-label="Editor mode">
      <button class:active={mode === 'design'} onclick={() => mode = 'design'}>✎ Design</button>
      <button class:active={mode === 'play'} onclick={() => mode = 'play'}>▶ Play</button>
    </div>
  </header>

  <div class="editor-layout">
    <aside class="sidebar" inert={mode === 'play'}>
      <div class="panel-heading">Block palette</div>
      <p class="muted">Drag blocks onto the sheet, inside containers or between blocks. Use the canvas gutters for top-level placement. Click to insert at the cursor.</p>
      <div class="panel-heading">Stock blocks</div>
      <label class="property">
        <span>After saving a custom block</span>
        <select aria-label="After saving a custom block" bind:value={saveBehavior}>
          <option value="ask">Ask every time</option>
          <option value="replace">Replace original with custom block</option>
          <option value="keep">Keep original unchanged</option>
        </select>
      </label>
      <BlockPalette customBlocks={library.definitions}
        draggable={mode === 'design' && designTool === 'drag'} onInsert={insert}
        onDragStart={dragPaletteBlock} onDragEnd={finishPaletteDrag}
        onEdit={(block) => { editedBlock = block; pendingConversion = null; }}
        onDelete={deleteDefinition} />
      <div class="separator"></div>
      <div class="panel-heading">Formula fields</div>
      <p class="muted">Modify STR to watch STR_MOD, ATTACK and the stat blocks update.</p>
      <div class="field-list">
        {#each Object.keys(fields) as id (id)}
          <label class="field-row">
            <span>{id}</span>
            <input aria-label={`Formula for ${id}`} spellcheck="false" bind:value={fields[id].formula} />
          </label>
        {/each}
      </div>
      <form class="new-field" onsubmit={(event) => { event.preventDefault(); addField(); }}>
        <input aria-label="New field identifier" placeholder="FIELD_ID" bind:value={newField} />
        <input aria-label="New field formula" placeholder="Formula" bind:value={newExpression} />
        <button type="submit">+ Add field</button>
      </form>
      {#if fieldError}<p class="error">{fieldError}</p>{/if}
    </aside>

    <main class="main-pane">
      <div class="pane-title" inert={mode === 'play'}>
        <div>
          <strong>Sheet canvas</strong>
          <span>{mode === 'play' ? 'Read-only layout · live formulas and rolls' : designTool === 'drag' ? 'Drag blocks or their handles to move them · text editing is disabled' : 'Edit content directly · block dragging disabled'}</span>
        </div>
        {#if mode === 'design'}
          <div class="canvas-actions">
            <div class="design-tools" role="group" aria-label="Design tool">
              <button class:active={designTool === 'edit'} aria-pressed={designTool === 'edit'}
                onclick={() => designTool = 'edit'}>Edit</button>
              <button class:active={designTool === 'drag'} aria-pressed={designTool === 'drag'}
                onclick={() => designTool = 'drag'}>Drag</button>
            </div>
            <button class="subtle-button" onclick={selectContainer}>Select parent container</button>
          </div>
        {/if}
      </div>
      <div class="sheet-frame" class:playing={mode === 'play'}>
        <div class="sheet-content" role="group" aria-label="Sheet canvas" oncontextmenu={contextMenu}>
          <div bind:this={canvas}></div>

        </div>
      </div>
      {#if message}<div class="status" role="status" inert={mode === 'play'}>{message}</div>{/if}

      <div class="source-panels" inert={mode === 'play'}>
        <section class="source-panel">
          <div class="source-heading">
            <strong>Sheet JSON</strong>
            <div class="source-actions">
              <button onclick={exportSheet}>Export</button>
              <button onclick={importSheet}>Import</button>
              <button class="format-button" title="Format JSON" aria-label="Format JSON" onclick={formatJSON}>Format</button>
            </div>
          </div>
          <CodeEditor language="json" label="Sheet JSON" value={jsonSource} onChange={(next) => jsonSource = next} />
        </section>
        <section class="source-panel">
          <div class="source-heading">
            <strong>Theme CSS</strong>
            <div class="source-actions">
              <span>Live preview · draft</span>
              <button onclick={saveThemeCSS}>Save</button>
              <button onclick={discardThemeCSS}>Discard</button>
              <button class="format-button" title="Format CSS" aria-label="Format CSS" onclick={formatCSS}>Format</button>
            </div>
          </div>
          <CodeEditor language="css" label="Theme CSS" value={css} onChange={(next) => css = next} />
        </section>
      </div>
    </main>

    <aside class="sidebar inspector" inert={mode === 'play'}>
      <div class="panel-heading">Properties</div>
      {#if mode !== 'design'}
        <p class="muted">Switch to Design to modify nodes.</p>
      {:else if selected}
        <div class="selection-heading"><strong>{selected.type}</strong><span>node at {selected.pos}</span></div>
        {#if !selectedIsInsideCustomBlock()}<label class="property">
          <span>CSS classes</span>
          <input
            aria-label="Selected block CSS classes"
            value={String(selected.attrs.class ?? '')}
            oninput={(event) => editAttribute('class', event.currentTarget.value)}
          />
        </label>{/if}
        {#if selected.type === 'formula'}
          <label class="property">
            <span>Field ID</span>
            <input aria-label="Selected formula field" value={String(selected.attrs.field ?? '')}
              oninput={(event) => editAttribute('field', event.currentTarget.value)} />
          </label>
        {:else if selected.type === 'image'}
          <label class="property">
            <span>Image URL</span>
            <input aria-label="Selected image URL" value={String(selected.attrs.src ?? '')}
              oninput={(event) => editAttribute('src', event.currentTarget.value)} />
          </label>
          <label class="property">
            <span>Alt text</span>
            <input aria-label="Selected image description" value={String(selected.attrs.alt ?? '')}
              oninput={(event) => editAttribute('alt', event.currentTarget.value)} />
          </label>
        {:else if selected.type === 'textBlock'}
          <p class="muted">Edit the text directly on the canvas.</p>
        {:else}
          <p class="muted">The container can hold other blocks. Select its inner blocks or edit its CSS layout rules.</p>
        {/if}
        {#if !selectedIsInsideCustomBlock()}<button class="danger-button" onclick={removeSelected}>Delete selected block</button>{/if}
      {:else}
        <p class="muted">Select a text, formula, image or container block to edit its properties.</p>
      {/if}
      <div class="separator"></div>
      <div class="panel-heading">Notes</div>
      <p class="muted">The editor uses only our registered nodes. The formulas are shared reactive state, not copied into Tiptap nodes.</p>
      <p class="muted">Nested blocks show a space-occupying drop preview while dragging, including in grid and flex layouts. Freeform grid snapping and isolated CSS remain future work.</p>
    </aside>
  </div>
</div>

{#if contextPosition !== null}
  {@const position = contextPosition}
  <div class="context-action" style:left={`${contextCoords.x}px`} style:top={`${contextCoords.y}px`}>
    <button onclick={() => { startNewDefinition(position); contextPosition = null; }}>Save as custom block</button>
    <button onclick={() => contextPosition = null} aria-label="Close context menu">✕</button>
  </div>
{/if}
{#if editedBlock}
  <CustomBlockEditorModal
    initial={editedBlock}
    initialCSS={blockCSS[editedBlock.typeId] ?? ''}
    {library} {fields}
    onSave={saveDefinition}
    onClose={() => { editedBlock = null; pendingConversion = null; pendingOriginalValues = {}; }}
  />
{/if}
{#if conversionPrompt}
  <div class="confirmation-backdrop">
    <div class="confirmation" role="dialog" aria-modal="true" aria-label="Saved custom block">
      <h2>Custom block saved</h2>
      <p>Replace the original container with an instance of the new custom block?</p>
      <label><input type="checkbox" bind:checked={rememberChoice}/> Remember for this session</label>
      <div class="confirmation-actions">
        <button onclick={() => conversionChoice(false)}>Keep original</button>
        <button onclick={() => conversionChoice(true)}>Replace original</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f2f1ee; color: #312d2a; font-family: Inter, system-ui, -apple-system, sans-serif; }
  :global(button), :global(input), :global(textarea) { font: inherit; }
  button { cursor: pointer; }
  .workspace { display: flex; flex-direction: column; min-height: 100dvh; }
  .topbar { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 24px 30px; background: #23282c; color: #faf8f5; }
  .eyebrow { color: #c9a274; font-size: .67rem; font-weight: 800; letter-spacing: .15em; }
  h1 { margin: 5px 0 3px; font-size: 1.7rem; }
  .topbar p { margin: 0; font-size: .87rem; color: #bdbfc0; }
  .mode-switch { display: flex; gap: 4px; background: #161c1f; padding: 5px; border-radius: 10px; }
  .mode-switch button { background: transparent; border: 0; color: #c5c8ca; border-radius: 7px; padding: 9px 15px; font-size: .83rem; }
  .mode-switch button.active { background: #ddbd8c; color: #242526; font-weight: 800; }
  .editor-layout {
    display: grid;
    flex: 1;
    grid-template-columns: 240px minmax(0, 1fr) 230px;
    align-items: stretch;
    min-height: 0;
    transition: grid-template-columns 460ms cubic-bezier(.2, .7, .2, 1);
  }
  .sidebar {
    min-width: 0;
    min-height: 0;
    padding: 22px 16px;
    overflow: hidden;
    background: #fbfaf8;
    border-right: 1px solid #dedad4;
    transition: opacity 240ms ease, padding 460ms ease,
      border-color 460ms ease, visibility 0s linear 460ms;
  }
  .inspector { border-right: 0; border-left: 1px solid #dedad4; }
  .panel-heading { color: #4c4034; text-transform: uppercase; letter-spacing: .09em; font-weight: 800; font-size: .72rem; }
  .muted { font-size: .76rem; line-height: 1.55; color: #8b8178; margin: 9px 0 16px; }
  .context-action { position: fixed; z-index: 50; display: flex; gap: 6px; padding: 10px; background: #fff7e9; border: 1px solid #c7ab83; border-radius: 8px; margin: 8px; }
  .context-action button { border: 1px solid #d4c7b7; border-radius: 6px; padding: 7px; background: white; cursor: pointer; }
  .confirmation-backdrop { position: fixed; inset: 0; z-index: 120; background: #0008; display: grid; place-items: center; }
  .confirmation { background: #fffaf3; padding: 24px; border-radius: 12px; width: min(420px, 90vw); box-shadow: 0 20px 50px #0004; }
  .confirmation h2 { font-size: 1.1rem; }
  .confirmation label { display: flex; gap: 8px; align-items: center; font-size: .85rem; }
  .confirmation label input { width: auto; min-width: 0; }
  .confirmation-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  .confirmation-actions button { padding: 9px; border: 1px solid #d4c7b7; background: #f6e7cf; border-radius: 7px; cursor: pointer; }
  select { width: 100%; padding: 8px; border: 1px solid #d8d2c9; border-radius: 6px; background: white; }






  .separator { height: 1px; background: #e8e2db; margin: 21px 0; }
  .field-list { display: flex; flex-direction: column; gap: 8px; }
  .field-row { display: grid; gap: 4px; }
  .field-row span { color: #746353; font: 700 .67rem ui-monospace, monospace; }
  input { width: 100%; min-width: 0; border: 1px solid #d8d2c9; background: #fff; border-radius: 6px; padding: 8px; color: #292723; outline-color: #987451; }
  .field-row input, .new-field input { font: .73rem ui-monospace, monospace; }
  .new-field { display: grid; gap: 8px; margin-top: 15px; }
  .new-field button { padding: 8px; border: 1px solid #a57e4f; border-radius: 7px; color: #5b401e; background: #f8e9d0; font-size: .78rem; font-weight: 700; }
  .error { color: #b34536; font-size: .73rem; }
  .main-pane {
    display: flex;
    flex-direction: column;
    padding: 23px;
    min-width: 0;
    transition: padding 460ms ease;
  }
  .pane-title, .sheet-frame, .status { flex-shrink: 0; }
  .pane-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 15px;
    max-height: 180px;
    overflow: hidden;
    transition: opacity 200ms ease, max-height 460ms ease,
      margin-bottom 460ms ease, visibility 0s linear 460ms;
  }
  .pane-title strong { display: block; font-size: .89rem; }
  .pane-title span { display: block; color: #8e867d; font-size: .76rem; margin-top: 4px; }
  .subtle-button { border: 1px solid #d4c7b7; color: #766149; background: #faf7f3; border-radius: 8px; padding: 9px; font-size: .72rem; }
  .canvas-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .design-tools { display: flex; gap: 3px; padding: 3px; border: 1px solid #d4c7b7; border-radius: 8px; background: #faf7f3; }
  .design-tools button { border: 0; border-radius: 5px; background: transparent; color: #766149; padding: 6px 10px; font-size: .72rem; }
  .design-tools button.active { background: #e8d5b7; color: #4d3923; font-weight: 700; }
  .sheet-frame {
    width: 100%;
    background: #fdfaf4;
    border: 1px solid #ded3c5;
    border-radius: 14px;
    box-shadow: 0 10px 30px #332c2410;
    transition: max-width 460ms cubic-bezier(.2, .7, .2, 1);
  }
  .sheet-content { min-height: 310px; }
  /* Keep the canvas gutters inside the editor so they receive drag events. */
  .sheet-content :global(.tiptap) { outline: none; padding: 28px; min-height: 310px; }
  .sheet-content :global(.tiptap > *) { margin-top: 0; }
  .sheet-content :global(.tiptap p) { margin: 0; }
  .sheet-content :global(.tiptap .ProseMirror-selectednode) { outline: 2px solid #c68b3c !important; outline-offset: 3px; }
  .sheet-content :global(.tiptap:is([contenteditable="true"], [data-rbb-drag-mode="true"]) section) { outline: 1px dashed #d9c9b1; outline-offset: 2px; }
  .sheet-content :global(.tiptap:is([contenteditable="true"], [data-rbb-drag-mode="true"]) section:hover) { outline-color: #b48348; }
  .playing .sheet-content :global(.tiptap section) { outline: none; }
  .sheet-content :global(.tiptap[data-rbb-drag-mode="true"]) { user-select: none; caret-color: transparent; cursor: grab; }
  .sheet-content :global(.tiptap[data-rbb-drag-mode="true"] [draggable="true"]) { cursor: grab; }
  .sheet-content :global(.rbb-block-drag-rail) {
    position: fixed;
    z-index: 20;
    display: flex;
    gap: 4px;
    align-items: flex-start;
    padding-right: 6px;
    pointer-events: auto;
  }
  .sheet-content :global(.rbb-block-drag-rail[hidden]) { display: none; }
  .sheet-content :global(.rbb-block-drag-handle) {
    flex: 0 0 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 24px;
    padding: 0;
    border: 1px solid #d4c7b7;
    border-radius: 5px;
    background: #fdfaf4;
    color: #907b61;
    box-shadow: 0 1px 4px #332c2414;
    cursor: grab;
    user-select: none;
  }
  .sheet-content :global(.rbb-block-drag-handle[hidden]) { display: none; }
  .sheet-content :global(.rbb-block-drag-handle:hover) { border-color: #b48348; color: #684a28; background: #fff4df; }
  .sheet-content :global(.rbb-block-drag-handle:active) { cursor: grabbing; }
  .sheet-content :global(.rbb-block-drag-handle:focus-visible) { outline: 2px solid #a47a4b; outline-offset: 2px; }
  .sheet-content :global(.rbb-block-highlight-overlay) {
    position: fixed;
    z-index: 19;
    pointer-events: none;
    box-sizing: border-box;
    border: 2px solid #b48348;
    border-radius: 3px;
    outline: 1px solid #fff8ed;
    outline-offset: 1px;
  }
  .sheet-content :global(.rbb-block-highlight-overlay[hidden]) { display: none; }
  .sheet-content :global(.rbb-drop-placeholder) {
    box-sizing: border-box;
    display: block;
    min-width: 0;
    max-width: 100%;
    border: 2px dashed #b9874c;
    background: repeating-linear-gradient(-45deg, #e9d7b94d 0 9px, #dcb98b33 9px 18px);
    border-radius: 9px;
    pointer-events: none;
    align-self: stretch;
  }
  .sheet-content :global(.rbb-drag-origin) { opacity: .4; }
  .status {
    font-size: .73rem;
    color: #816544;
    margin: 12px 0;
    min-height: 18px;
    max-height: 80px;
    transition: max-height 460ms ease, min-height 460ms ease,
      margin 460ms ease, opacity 200ms ease,
      visibility 0s linear 460ms;
  }
  .source-panels {
    display: grid;
    flex: 1 1 320px;
    min-height: 0;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    margin-top: 25px;
    overflow: hidden;
    transition: flex-grow 460ms ease, flex-basis 460ms ease,
      opacity 200ms ease, margin-top 460ms ease,
      visibility 0s linear 460ms;
  }
  .source-panel { display: flex; flex-direction: column; min-width: 0; background: #fff; border: 1px solid #e4ded5; border-radius: 10px; overflow: hidden; }
  .source-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid #eee9e2; font-size: .76rem; }
  .source-heading span { color: #8a806f; }
  .source-actions { display: flex; gap: 6px; align-items: center; }
  .source-actions button { border: 1px solid #d8c7b4; border-radius: 5px; background: #faf6ef; padding: 5px 9px; font-size: .7rem; }
  .source-actions .format-button { border-color: transparent; background: transparent; color: #80776d; font-size: .67rem; padding: 4px 6px; }
  .source-actions .format-button:hover { border-color: #d8c7b4; background: #f7f3ed; color: #564433; }
  .source-actions .format-button:focus-visible { outline: 2px solid #a47a4b; outline-offset: 2px; }
  .selection-heading { display: flex; justify-content: space-between; gap: 10px; margin: 18px 0; }
  .selection-heading strong { font-size: .85rem; }
  .selection-heading span { color: #8c7f70; font-size: .67rem; }
  .property { display: grid; gap: 7px; margin: 0 0 14px; }
  .property span { font-size: .75rem; color: #6d6155; font-weight: 700; }
  .property input { font-size: .77rem; }
  .danger-button { border: 1px solid #e5c8c0; border-radius: 7px; background: #fff5f3; color: #a74335; padding: 9px; font-size: .76rem; }

  /* Keep the live editor and CodeMirror mounted while the workspace recedes. */
  .playing .editor-layout { grid-template-columns: 0px minmax(0, 1fr) 0px; }
  .playing .sidebar {
    padding-inline: 0;
    opacity: 0;
    visibility: hidden;
    border-color: transparent;
    pointer-events: none;
  }
  .playing .main-pane { padding: clamp(20px, 4vw, 56px); }
  .playing .pane-title, .playing .source-panels, .playing .status {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .playing .pane-title { max-height: 0; margin-bottom: 0; }
  .playing .source-panels {
    flex-grow: 0;
    flex-basis: 0px;
    margin-top: 0;
  }
  .playing .status { max-height: 0; min-height: 0; margin: 0; overflow: hidden; }
  .playing .sheet-frame { max-width: 1050px; margin-inline: auto; }
  .playing .sheet-content :global(.ProseMirror-selectednode) { outline: none !important; }

  @media (prefers-reduced-motion: reduce) {
    .editor-layout, .sidebar, .main-pane, .pane-title, .source-panels,
    .sheet-frame { transition-duration: 0ms; }
  }

  @media (max-width: 1000px) {
    .editor-layout { grid-template-columns: 190px minmax(0,1fr); }
    .playing .editor-layout { grid-template-columns: 0px minmax(0,1fr); }
    .playing .inspector { max-height: 0; padding-block: 0; border-width: 0; }
    .inspector { grid-column: 1 / -1; min-height: 0; border-left: 0; border-top: 1px solid #dedad4; }
    .sidebar { min-height: 0; }
    .source-panels { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .topbar { flex-direction: column; align-items: flex-start; }
    .editor-layout { display: flex; flex-direction: column; }
    .sidebar, .main-pane { width: 100%; }
    .sidebar { flex-shrink: 0; }
    .source-panels { min-height: 100dvh; }
    .playing .sidebar { max-height: 0; padding-block: 0; }
    .playing .source-panels { min-height: 0; }
    .sheet-content :global(.tiptap) { padding: 15px; }
  }
</style>
