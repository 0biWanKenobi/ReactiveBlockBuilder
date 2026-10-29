<script lang="ts">
  import { onMount } from 'svelte';
  import '../styles/shared.css';
  import CustomBlockEditorModal from '../lib/custom-blocks/CustomBlockEditorModal.svelte';
  import { CustomBlockLibrary } from '../lib/custom-blocks/library.svelte.js';
  import { CustomBlockRepository } from '../lib/custom-blocks/repository.js';
  import { LocalStorageAdapter } from '../lib/storage/StorageAdapter.js';
  import { createDefinition, makeInstance, expandDocument, collapseDocument, captureInitialValues, validateDefinition } from '../lib/custom-blocks/model.js';
  import type { CustomBlockDefinition } from '../lib/custom-blocks/types.js';
  import type { Editor } from '@tiptap/core';
  import { initialFields } from '../lib/index.js';
  import type { Sheet } from '../lib/index.js';
  import LeftSidebar from './components/leftSidebar.svelte';
  import MainPane from './components/mainPane/mainPane.svelte';
  import Inspector from './components/inspector.svelte';

  let editor = $state<Editor | null>(null);
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
      onSaveAsCustomBlock={startNewDefinition}
    />

    <Inspector {mode} {editor} />
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
  .confirmation-backdrop { position: fixed; inset: 0; z-index: 120; background: #0008; display: grid; place-items: center; }
  .confirmation { background: #fffaf3; padding: 24px; border-radius: 12px; width: min(420px, 90vw); box-shadow: 0 20px 50px #0004; }
  .confirmation h2 { font-size: 1.1rem; }
  .confirmation label { display: flex; gap: 8px; align-items: center; font-size: .85rem; }
  .confirmation label input { width: auto; min-width: 0; }
  .confirmation-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  .confirmation-actions button { padding: 9px; border: 1px solid #d4c7b7; background: #f6e7cf; border-radius: 7px; cursor: pointer; }

  /* Keep the live editor and CodeMirror mounted while the workspace recedes. */
  .playing .editor-layout { grid-template-columns: 0px minmax(0, 1fr) 0px; }

  @media (prefers-reduced-motion: reduce) {
    .editor-layout { transition-duration: 0ms; }
  }

  @media (max-width: 1000px) {
    .editor-layout { grid-template-columns: 190px minmax(0,1fr); }
    .playing .editor-layout { grid-template-columns: 0px minmax(0,1fr); }
  }
  @media (max-width: 620px) {
    .topbar { flex-direction: column; align-items: flex-start; }
    .editor-layout { display: flex; flex-direction: column; }
  }
</style>
