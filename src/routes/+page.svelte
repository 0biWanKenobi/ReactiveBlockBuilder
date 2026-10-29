<script lang="ts">
  import { onMount } from 'svelte';
  import CustomBlockEditorModal from '../lib/custom-blocks/CustomBlockEditorModal.svelte';
  import { CustomBlockLibrary } from '../lib/custom-blocks/library.svelte.js';
  import { CustomBlockRepository } from '../lib/custom-blocks/repository.js';
  import { LocalStorageAdapter } from '../lib/storage/StorageAdapter.js';
  import { createDefinition, makeInstance, expandDocument, collapseDocument, captureInitialValues, validateDefinition } from '../lib/custom-blocks/model.js';
  import type { CustomBlockDefinition } from '../lib/custom-blocks/types.js';
  import type { Editor } from '@tiptap/core';
  import { selectedBlock, updateBlockAttribute } from '../lib/editor/selection.js';
  import { allowedNodeTypes, initialFields } from '../lib/index.js';
  import type { Sheet, SheetNodeType } from '../lib/index.js';
  import LeftSidebar from './components/leftSidebar.svelte';
  import MainPane from './components/mainPane/mainPane.svelte';

  type SelectedBlock = {
    type: SheetNodeType;
    pos: number;
    attrs: Record<string, unknown>;
  };

  let editor = $state<Editor | null>(null);
  let selected = $state<SelectedBlock | null>(null);
  let mode = $state<'design' | 'play'>('design');
  let fields = $state<Sheet>(structuredClone(initialFields));
  const library = new CustomBlockLibrary();
  const repository = new CustomBlockRepository(new LocalStorageAdapter());
  let blockCSS = $state<Record<string, string>>({});
  let editedBlock = $state<CustomBlockDefinition | null>(null);
  let editedCSS = $state<string | null>(null);
  let definitionTrail = $state<{ definition: CustomBlockDefinition; css: string }[]>([]);
  let pendingConversion = $state<number | null>(null);
  let pendingOriginalValues = $state<Record<string, string | { src: string; alt: string }>>({});
  let saveBehavior = $state<'ask' | 'replace' | 'keep'>('ask');
  let conversionPrompt = $state<{ pos: number; typeId: string } | null>(null);
  let rememberChoice = $state(false);
  let message = $state('');

  function synchronizeSelection(current: Editor) {
    const found = selectedBlock(current);
    selected = found && allowedNodeTypes.includes(found.type as SheetNodeType)
      ? { ...found, type: found.type as SheetNodeType }
      : null;
  }

  onMount(() => {
    void (async () => {
      try {
        library.replace(await repository.list());
        await reloadBlockStyles();
      } catch (error) {
        message = `Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    })();
  });

  async function reloadBlockStyles() {
    const styles: Record<string, string> = {};
    for (const definition of library.list()) {
      styles[definition.typeId] = await repository.readBlockCSS(definition.typeId);
    }
    blockCSS = styles;
  }

  function startNewDefinition(pos: number) {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'container' || !node.childCount) return;
    const name = String(node.attrs.class ?? '').trim().split(/\s+/)[0] || 'Custom block';
    try {
      definitionTrail = [];
      editedCSS = null;
      editedBlock = createDefinition(name, node.toJSON(), library);
      const expandedTemplate = expandDocument({ type: 'doc', content: [editedBlock.structure] }, library).content?.[0];
       pendingOriginalValues = captureInitialValues(expandedTemplate ?? editedBlock.structure, node.toJSON());
      pendingConversion = pos;
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

  async function openNestedDefinition(typeId: string, current: CustomBlockDefinition, draftCSS: string) {
    const target = library.get(typeId);
    if (!target) { message = `Missing custom block definition: ${typeId}`; return; }
    definitionTrail = [...definitionTrail, { definition: current, css: draftCSS }];
    editedBlock = target;
    editedCSS = null;
  }

  function closeDefinition() {
    const previous = definitionTrail.at(-1);
    if (previous) {
      definitionTrail = definitionTrail.slice(0, -1);
      editedBlock = previous.definition;
      editedCSS = previous.css;
    } else {
      editedBlock = null;
      editedCSS = null;
      pendingConversion = null;
      pendingOriginalValues = {};
    }
  }

  async function saveDefinition(definition: CustomBlockDefinition, blockStyle: string) {
    try {
      // Capture changes against the old definition before it is replaced.
      const compact = editor ? collapseDocument(editor.getJSON(), library) : null;
      validateDefinition(definition, library);
      await repository.save(definition);
      await repository.writeBlockCSS(definition.typeId, blockStyle);
      library.upsert(definition);
      if (editor && compact) {
        editor.chain().setMeta('rbb:definition-reconcile', true).setContent(expandDocument(compact, library)).run();
      }
      await reloadBlockStyles();
      if (definitionTrail.length) {
        const previous = definitionTrail.at(-1)!;
        definitionTrail = definitionTrail.slice(0, -1);
        editedBlock = previous.definition;
        editedCSS = previous.css;
      } else {
        editedBlock = null;
        editedCSS = null;
      }
      if (pendingConversion !== null && !definitionTrail.length && !editedBlock) {
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

  function editAttribute(attribute: string, value: string) {
    if (!editor || !selected) return;
    const node = editor.state.doc.nodeAt(selected.pos);
    if (!node || node.type.name !== selected.type) return;
    if (attribute === 'class' && selectedIsInsideCustomBlock()) return;
    updateBlockAttribute(editor, selected.pos, attribute, value);
  }

  function selectedIsInsideCustomBlock() {
    if (!editor || !selected) return false;
    const resolved = editor.state.doc.resolve(selected.pos);
    for (let depth = 1; depth <= resolved.depth; depth++) {
      if (resolved.node(depth).type.name === 'customBlock') return true;
    }
    return editor.state.doc.nodeAt(selected.pos)?.type.name === 'customBlock';
  }

  function removeSelected() {
    if (!editor || !selected) return;
    const node = editor.state.doc.nodeAt(selected.pos);
    if (!node) return;
    editor.commands.deleteRange({ from: selected.pos, to: selected.pos + node.nodeSize });
    selected = null;
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
    <LeftSidebar
      {mode} {saveBehavior} {library} {editor} {repository}
      sheet={fields}
      onDragPaletteBlock={({success, message: msg}) => {
        if(!success) message = msg
      }}
      onBlockEdit={(block) => {
          editedCSS = null;
          definitionTrail = [];
          editedBlock = block;
          pendingConversion = null;
        }}
      onBlockDelete={async ({success, message: msg}) => {
        if(!success) message = msg;
        else await reloadBlockStyles();
      }} />

    <MainPane
      {mode} bind:editor bind:fields {library} {repository} {blockCSS} bind:message
      onSelectionChange={synchronizeSelection}
      onSaveAsCustomBlock={startNewDefinition}
    />

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
    </aside>
  </div>
</div>

{#if editedBlock}
  {#key editedBlock.typeId}
  <CustomBlockEditorModal
    initial={editedBlock}
    initialCSS={editedCSS ?? blockCSS[editedBlock.typeId] ?? ''}
    {library} {fields}
    onSave={saveDefinition}
    onNavigate={openNestedDefinition}
    onClose={closeDefinition}
    breadcrumbs={definitionTrail.map((frame) => frame.definition.name)}
  />
  {/key}
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
  .confirmation-backdrop { position: fixed; inset: 0; z-index: 120; background: #0008; display: grid; place-items: center; }
  .confirmation { background: #fffaf3; padding: 24px; border-radius: 12px; width: min(420px, 90vw); box-shadow: 0 20px 50px #0004; }
  .confirmation h2 { font-size: 1.1rem; }
  .confirmation label { display: flex; gap: 8px; align-items: center; font-size: .85rem; }
  .confirmation label input { width: auto; min-width: 0; }
  .confirmation-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  .confirmation-actions button { padding: 9px; border: 1px solid #d4c7b7; background: #f6e7cf; border-radius: 7px; cursor: pointer; }
  .separator { height: 1px; background: #e8e2db; margin: 21px 0; }
  input { width: 100%; min-width: 0; border: 1px solid #d8d2c9; background: #fff; border-radius: 6px; padding: 8px; color: #292723; outline-color: #987451; }
  .selection-heading { display: flex; justify-content: space-between; gap: 10px; margin: 18px 0; }
  .selection-heading strong { font-size: .85rem; }
  .selection-heading span { color: #8c7f70; font-size: .67rem; }
  .property { display: grid; gap: 7px; margin: 0 0 14px; }
  .property span { font-size: .75rem; color: #6d6155; font-weight: 700; }
  .property input { font-size: .77rem; }
  .danger-button { border: 1px solid #e5c8c0; border-radius: 7px; background: #fff5f3; color: #a74335; padding: 9px; font-size: .76rem; }

  /* Keep the live editor and CodeMirror mounted while the workspace recedes. */
  .playing .editor-layout { grid-template-columns: 0px minmax(0, 1fr) 0px; }

  @media (prefers-reduced-motion: reduce) {
    .editor-layout, .sidebar { transition-duration: 0ms; }
  }

  @media (max-width: 1000px) {
    .editor-layout { grid-template-columns: 190px minmax(0,1fr); }
    .playing .editor-layout { grid-template-columns: 0px minmax(0,1fr); }
    .playing .inspector { max-height: 0; padding-block: 0; border-width: 0; }
    .inspector { grid-column: 1 / -1; min-height: 0; border-left: 0; border-top: 1px solid #dedad4; }
    .sidebar { min-height: 0; }
  }
  @media (max-width: 620px) {
    .topbar { flex-direction: column; align-items: flex-start; }
    .editor-layout { display: flex; flex-direction: column; }
    .sidebar { width: 100%; }
    .sidebar { flex-shrink: 0; }
    .playing .sidebar { max-height: 0; padding-block: 0; }
  }
</style>
