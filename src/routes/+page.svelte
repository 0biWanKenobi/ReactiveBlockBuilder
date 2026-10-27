<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from '../lib/editor/CodeEditor.svelte';
  import { Editor, type JSONContent } from '@tiptap/core';
  import { NodeSelection } from '@tiptap/pm/state';
  import {
    createSheetExtensions, insertionSamples, allowedNodeTypes,
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
    css: string;
    fields: Sheet;
  };

  let canvas: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  let selected = $state<SelectedBlock | null>(null);
  let mode = $state<'design' | 'play'>('design');
  let fields = $state<Sheet>(structuredClone(initialFields));
  let css = $state(defaultCSS);
  let jsonSource = $state(JSON.stringify({
    version: 1, document: sampleDocument, css: defaultCSS, fields: initialFields
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
    if (styleElement) styleElement.textContent = css;
  });

  $effect(() => {
    editor?.setEditable(mode === 'design');
  });

  function insert(type: SheetNodeType) {
    if (!editor) return;
    mode = 'design';
    // Use a fresh node object; Tiptap may normalize its content.
    editor.chain().focus().insertContent(structuredClone(insertionSamples[type])).run();
    message = `Added ${type} block`;
  }

  function editAttribute(attribute: string, value: string) {
    if (!editor || !selected) return;
    const node = editor.state.doc.nodeAt(selected.pos);
    if (!node || node.type.name !== selected.type) return;
    // Do not call editor.focus(): doing so would steal focus from the property input.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(
      selected.pos, undefined, { ...node.attrs, [attribute]: value }
    ));
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
      document: editor.getJSON(),
      css,
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
          typeof imported.css !== 'string' ||
          !imported.fields || typeof imported.fields !== 'object' || Array.isArray(imported.fields)) {
        throw new Error('Expected version 1 sheet with document, css and fields');
      }
      validateNode(imported.document);
      // Preserve the reactive proxy: existing node views hold a reference to it.
      for (const key of Object.keys(fields)) delete fields[key];
      for (const [key, value] of Object.entries(imported.fields)) {
        if (validateId(key) || !value || typeof value.formula !== 'string') {
          throw new Error(`Invalid formula field ${key}`);
        }
        fields[key] = { id: key, formula: value.formula };
      }
      css = imported.css;
      editor.commands.setContent(imported.document);
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

<div class="workspace">
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
    <aside class="sidebar">
      <div class="panel-heading">Block palette</div>
      <p class="muted">Insert into the current document position. Select inside a container to insert nested blocks.</p>
      <div class="palette">
        <button onclick={() => insert('container')}><span>▦</span> Container</button>
        <button onclick={() => insert('textBlock')}><span>¶</span> Text</button>
        <button onclick={() => insert('formula')}><span>ƒ</span> Formula</button>
        <button onclick={() => insert('image')}><span>▧</span> Image</button>
      </div>
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
      <div class="pane-title">
        <div>
          <strong>Sheet canvas</strong>
          <span>{mode === 'design' ? 'Click or type into blocks; drag a node to reorder it' : 'Read-only layout · live formulas and rolls'}</span>
        </div>
        {#if mode === 'design'}
          <button class="subtle-button" onclick={selectContainer}>Select parent container</button>
        {/if}
      </div>
      <div class="sheet-frame" class:playing={mode === 'play'}>
        <div class="sheet-content">
          <div bind:this={canvas}></div>
        </div>
      </div>
      {#if message}<div class="status" role="status">{message}</div>{/if}

      <div class="source-panels">
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
            <strong>Custom CSS</strong>
            <div class="source-actions">
              <span>Live</span>
              <button class="format-button" title="Format CSS" aria-label="Format CSS" onclick={formatCSS}>Format</button>
            </div>
          </div>
          <CodeEditor language="css" label="Custom sheet CSS" value={css} onChange={(next) => css = next} />
        </section>
      </div>
    </main>

    <aside class="sidebar inspector">
      <div class="panel-heading">Properties</div>
      {#if mode !== 'design'}
        <p class="muted">Switch to Design to modify nodes.</p>
      {:else if selected}
        <div class="selection-heading"><strong>{selected.type}</strong><span>node at {selected.pos}</span></div>
        <label class="property">
          <span>CSS classes</span>
          <input
            aria-label="Selected block CSS classes"
            value={String(selected.attrs.class ?? '')}
            oninput={(event) => editAttribute('class', event.currentTarget.value)}
          />
        </label>
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
        <button class="danger-button" onclick={removeSelected}>Delete selected block</button>
      {:else}
        <p class="muted">Select a text, formula, image or container block to edit its properties.</p>
      {/if}
      <div class="separator"></div>
      <div class="panel-heading">Notes</div>
      <p class="muted">The editor uses only our registered nodes. The formulas are shared reactive state, not copied into Tiptap nodes.</p>
      <p class="muted">Layouts use normal CSS (including grid and flex). Two-dimensional snap-to-grid dragging and isolated CSS are not part of this first draft.</p>
    </aside>
  </div>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f2f1ee; color: #312d2a; font-family: Inter, system-ui, -apple-system, sans-serif; }
  :global(button), :global(input), :global(textarea) { font: inherit; }
  button { cursor: pointer; }
  .workspace { min-height: 100vh; }
  .topbar { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 24px 30px; background: #23282c; color: #faf8f5; }
  .eyebrow { color: #c9a274; font-size: .67rem; font-weight: 800; letter-spacing: .15em; }
  h1 { margin: 5px 0 3px; font-size: 1.7rem; }
  .topbar p { margin: 0; font-size: .87rem; color: #bdbfc0; }
  .mode-switch { display: flex; gap: 4px; background: #161c1f; padding: 5px; border-radius: 10px; }
  .mode-switch button { background: transparent; border: 0; color: #c5c8ca; border-radius: 7px; padding: 9px 15px; font-size: .83rem; }
  .mode-switch button.active { background: #ddbd8c; color: #242526; font-weight: 800; }
  .editor-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr) 230px; align-items: start; min-height: calc(100vh - 109px); }
  .sidebar { padding: 22px 16px; background: #fbfaf8; min-height: calc(100vh - 109px); border-right: 1px solid #dedad4; }
  .inspector { border-right: 0; border-left: 1px solid #dedad4; }
  .panel-heading { color: #4c4034; text-transform: uppercase; letter-spacing: .09em; font-weight: 800; font-size: .72rem; }
  .muted { font-size: .76rem; line-height: 1.55; color: #8b8178; margin: 9px 0 16px; }
  .palette { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .palette button { display: flex; align-items: center; flex-direction: column; gap: 7px; padding: 13px 5px; border: 1px solid #ded6cb; background: white; border-radius: 9px; color: #4d463e; font-weight: 650; font-size: .75rem; }
  .palette button:hover { border-color: #a9773c; }
  .palette span { font-family: Georgia,serif; font-size: 1.5rem; color: #936a3e; }
  .separator { height: 1px; background: #e8e2db; margin: 21px 0; }
  .field-list { display: flex; flex-direction: column; gap: 8px; }
  .field-row { display: grid; gap: 4px; }
  .field-row span { color: #746353; font: 700 .67rem ui-monospace, monospace; }
  input { width: 100%; min-width: 0; border: 1px solid #d8d2c9; background: #fff; border-radius: 6px; padding: 8px; color: #292723; outline-color: #987451; }
  .field-row input, .new-field input { font: .73rem ui-monospace, monospace; }
  .new-field { display: grid; gap: 8px; margin-top: 15px; }
  .new-field button { padding: 8px; border: 1px solid #a57e4f; border-radius: 7px; color: #5b401e; background: #f8e9d0; font-size: .78rem; font-weight: 700; }
  .error { color: #b34536; font-size: .73rem; }
  .main-pane { padding: 23px; min-width: 0; }
  .pane-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 15px; }
  .pane-title strong { display: block; font-size: .89rem; }
  .pane-title span { display: block; color: #8e867d; font-size: .76rem; margin-top: 4px; }
  .subtle-button { border: 1px solid #d4c7b7; color: #766149; background: #faf7f3; border-radius: 8px; padding: 9px; font-size: .72rem; }
  .sheet-frame { background: #fdfaf4; border: 1px solid #ded3c5; border-radius: 14px; box-shadow: 0 10px 30px #332c2410; }
  .sheet-content { padding: 28px; min-height: 310px; }
  .sheet-content :global(.tiptap) { outline: none; min-height: 250px; }
  .sheet-content :global(.tiptap > *) { margin-top: 0; }
  .sheet-content :global(.tiptap p) { margin: 0; }
  .sheet-content :global(.tiptap .ProseMirror-selectednode) { outline: 2px solid #c68b3c !important; outline-offset: 3px; }
  .sheet-content :global(.tiptap[contenteditable="true"] section) { outline: 1px dashed #d9c9b1; outline-offset: 2px; }
  .sheet-content :global(.tiptap[contenteditable="true"] section:hover) { outline-color: #b48348; }
  .playing .sheet-content :global(.tiptap section) { outline: none; }
  .status { font-size: .73rem; color: #816544; margin: 12px 0; min-height: 18px; }
  .source-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 25px; }
  .source-panel { min-width: 0; background: #fff; border: 1px solid #e4ded5; border-radius: 10px; overflow: hidden; }
  .source-heading { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid #eee9e2; font-size: .76rem; }
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
  @media (max-width: 1000px) {
    .editor-layout { grid-template-columns: 190px minmax(0,1fr); }
    .inspector { grid-column: 1 / -1; min-height: 0; border-left: 0; border-top: 1px solid #dedad4; }
    .sidebar { min-height: 0; }
    .source-panels { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .topbar { flex-direction: column; align-items: flex-start; }
    .editor-layout { display: flex; flex-direction: column; }
    .sidebar, .main-pane { width: 100%; }
    .sheet-content { padding: 15px; }
  }
</style>
