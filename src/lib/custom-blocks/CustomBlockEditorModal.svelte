<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor, type JSONContent } from '@tiptap/core';
  import { selectedBlock, updateBlockAttribute } from '../editor/selection.js';
  import { createSheetExtensions } from '../editor/nodes.js';
  import { startPaletteDrag, endPaletteDrag } from '../editor/blockDragPreview.js';
  import { setBlockDragMode } from '../editor/blockInteraction.js';
  import BlockPalette from '../editor/BlockPalette.svelte';
  import CodeEditor from '../editor/CodeEditor.svelte';
  import { collapseDocument, ensureNodeIds, expandDocument, resetLeafDefaults } from './model.js';
  import type { CustomBlockDefinition, BlockLibrary } from './types.js';
  import type { Sheet } from '../formula/engine.js';

  let {
    initial, initialCSS, library, fields, onSave, onClose, onNavigate, breadcrumbs = []
  }: {
    initial: CustomBlockDefinition;
    initialCSS: string;
    library: BlockLibrary;
    fields: Sheet;
    onSave: (definition: CustomBlockDefinition, css: string) => void;
    onClose: () => void;
    onNavigate?: (typeId: string, current: CustomBlockDefinition, css: string) => void;
    breadcrumbs?: string[];
  } = $props();

  let name = $state(initial.name);
  let rootClass = $state(initial.rootClass);
  const starterCSS = initialCSS || `/*
 * Fill this with your styles as needed, or leave it empty.
 *
 * .custom-class {
 *
 * }
 */`;
  let css = $state(starterCSS);
  let jsonDraftEdited = $state(false);
  let structure = $state(JSON.stringify(initial.structure, null, 2));
  let tab = $state<'structure' | 'css'>('structure');
  let tool = $state<'edit' | 'drag'>('edit');
  let selected = $state<{ pos: number; type: string; attrs: Record<string, unknown> } | null>(null);
  type NestedValue = { pos: number; type: string; label: string; value: string; alt?: string };
  let nestedValues = $state<NestedValue[]>([]);
  let error = $state('');
  let canvas: HTMLDivElement;
  let editor: Editor | null = null;
  let previewStyle: HTMLStyleElement | null = null;

  function synchronizeSelection(instance: Editor) {
    const found = selectedBlock(instance);
    selected = found;
    nestedValues = [];
    const node = found ? { pos: found.pos, node: instance.state.doc.nodeAt(found.pos) } : null;
    if (node?.node?.type.name === 'customBlock') {
      node.node.descendants((child, offset) => {
        if (!['textBlock', 'formula', 'image'].includes(child.type.name)) return true;
        const type = child.type.name;
        nestedValues.push({
          pos: node.pos + 1 + offset,
          type,
          label: String(child.attrs.class ?? type) || type,
          value: type === 'textBlock'
            ? child.textContent
            : String(child.attrs[type === 'formula' ? 'field' : 'src'] ?? ''),
          alt: type === 'image' ? String(child.attrs.alt ?? '') : undefined
        });
        return false;
      });
    }
  }

  function currentStructure(): JSONContent {
    if (!editor) throw new Error('Preview is not initialized');
    const doc = collapseDocument(editor.getJSON(), library);
    const root = doc.content?.[0];
    if (!root || root.type !== 'container' || !root.content?.length) {
      throw new Error('Custom blocks require a non-empty root container');
    }
    return ensureNodeIds(root);
  }

  function syncStructure() {
    if (!editor) return;
    structure = JSON.stringify(currentStructure(), null, 2);
    jsonDraftEdited = false;
  }

  onMount(() => {
    previewStyle = document.createElement('style');
    previewStyle.dataset.customBlockDraft = initial.typeId;
    document.head.appendChild(previewStyle);
    previewStyle.textContent = `@scope (.rbb-definition-preview) {\n${css}\n}`;
    editor = new Editor({
      element: canvas,
      extensions: createSheetExtensions(fields),
      content: expandDocument({ type: 'doc', content: [initial.structure] }, library),
      onSelectionUpdate: ({ editor }) => synchronizeSelection(editor),
      onTransaction: ({ editor }) => synchronizeSelection(editor),
      onUpdate: () => { if (!jsonDraftEdited) syncStructure(); }
    });
    return () => { editor?.destroy(); editor = null; previewStyle?.remove(); previewStyle = null; };
  });

  $effect(() => {
    if (editor) setBlockDragMode(editor.view, tool === 'drag');
  });

  $effect(() => {
    if (previewStyle) previewStyle.textContent = `@scope (.rbb-definition-preview) {\n${css}\n}`;
  });

  function insert(block: JSONContent) {
    if (!editor) return;
    if (block.type === 'textBlock') block.content = [{ type: 'text', text: '...' }];
    const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
    if (!expanded) return;
    editor.chain().focus().insertContent(ensureNodeIds(expanded)).run();
    syncStructure();
  }

  function dragStart(event: DragEvent, block: JSONContent) {
    if (!editor) { event.preventDefault(); return; }
    const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
    if (expanded) startPaletteDrag(editor.view, event, ensureNodeIds(expanded));
  }

  /**
   * In the definition editor, clicking a nested custom block selects the
   * component instance rather than one of its implementation nodes.
   * Parent-specific values are then edited in the inspector.
   */
  function selectNestedFromPreview(event: MouseEvent) {
    if (!editor || !(event.target instanceof Element)) return;
    const nested = event.target.closest('section[data-custom-block-type]');
    if (!nested || !canvas.contains(nested)) return;
    const parent = nested.parentNode;
    if (!parent) return;
    const index = Array.prototype.indexOf.call(parent.childNodes, nested);
    if (index < 0) return;
    try {
      const pos = editor.view.posAtDOM(parent, index);
      if (editor.state.doc.nodeAt(pos)?.type.name === 'customBlock') {
        editor.commands.setNodeSelection(pos);
      }
    } catch {
      // Click targets are allowed to disappear during ProseMirror updates.
    }
  }

  function updateAttr(attribute: string, value: string) {
    if (!editor || !selected) return;
    const node = editor.state.doc.nodeAt(selected.pos);
    if (!node) return;
    updateBlockAttribute(editor, selected.pos, attribute, value);
    syncStructure();
  }

  function updateNestedValue(leaf: NestedValue, value: string, property: 'value' | 'alt' = 'value') {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(leaf.pos);
    if (!node || node.type.name !== leaf.type) return;
    const transaction = editor.state.tr;
    if (leaf.type === 'textBlock') {
      const content = value ? editor.state.schema.text(value) : undefined;
      transaction.replaceWith(leaf.pos, leaf.pos + node.nodeSize,
        node.type.create(node.attrs, content));
    } else {
      const key = property === 'alt' ? 'alt' : leaf.type === 'formula' ? 'field' : 'src';
      transaction.setNodeMarkup(leaf.pos, undefined, { ...node.attrs, [key]: value });
    }
    editor.view.dispatch(transaction);
    syncStructure();
  }

  function applyJSON() {
    try {
      const parsed = ensureNodeIds(JSON.parse(structure) as JSONContent);
      if (parsed.type !== 'container' || !parsed.content?.length) throw new Error('Expected a non-empty container');
      editor?.commands.setContent(expandDocument({ type: 'doc', content: [parsed] }, library));
      syncStructure();
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function resetValues() {
    try {
      const reset = resetLeafDefaults(currentStructure());
      editor?.commands.setContent(expandDocument({ type: 'doc', content: [reset] }, library));
      structure = JSON.stringify(reset, null, 2);
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function currentDraft(): CustomBlockDefinition {
    if (jsonDraftEdited) throw new Error('Unapplied JSON changes. Click Apply JSON before continuing.');
    return {
      typeId: initial.typeId,
      name: name.trim() || initial.name,
      rootClass: rootClass.trim(),
      structure: currentStructure()
    };
  }

  function dirty(): boolean {
    return name !== initial.name || rootClass !== initial.rootClass ||
      css !== starterCSS || jsonDraftEdited ||
      JSON.stringify(currentStructure()) !== JSON.stringify(initial.structure);
  }

  function close() {
    if (!dirty() || window.confirm('Discard unsaved changes to this definition?')) onClose();
  }

  function openNested() {
    if (!selected || selected.type !== 'customBlock' || !onNavigate) return;
    try {
      onNavigate(String(selected.attrs.typeId ?? ''), currentDraft(), css);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function save() {
    try {
      const next = currentDraft();
      onSave(next, css);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-label="Custom block definition editor">
    <header>
      <div>
        <strong>Custom block definition</strong>
        <span>{[...breadcrumbs, name].join(' / ')}</span>
      </div>
      <div class="nav-actions">
        {#if breadcrumbs.length}<button onclick={close} aria-label="Back to parent definition">← Back</button>{/if}
        <button onclick={close} aria-label="Close editor">✕</button>
      </div>
    </header>
    <div class="properties">
      <label>Name <input aria-label="Custom block name" bind:value={name} /></label>
      <label>Root CSS class <input aria-label="Root CSS class" bind:value={rootClass} placeholder="Optional class" /></label>
    </div>
    <div class="toolbar">
      <div class="switch">
        <button class:active={tab === 'structure'} onclick={() => tab = 'structure'}>Structure</button>
        <button class:active={tab === 'css'} onclick={() => tab = 'css'}>CSS</button>
      </div>
      {#if tab === 'structure'}
        <div class="switch">
          <button class:active={tool === 'edit'} onclick={() => tool = 'edit'}>Edit</button>
          <button class:active={tool === 'drag'} onclick={() => tool = 'drag'}>Drag</button>
        </div>
        <button onclick={resetValues}>Reset values to defaults</button>
      {/if}
    </div>
    <div class="body">
      <aside class="palette-pane">
        <div class="section-title">Blocks</div>
        <BlockPalette customBlocks={library.list().filter((item) => item.typeId !== initial.typeId)}
          draggable={true} onInsert={insert} onDragStart={dragStart}
          onDragEnd={() => editor && endPaletteDrag(editor.view)} />
        {#if selected}
          <div class="section-title">Selected: {selected.type}</div>
          {#if selected.type === 'customBlock'}
            <p class="hint">Nested block: {String(selected.attrs.typeId ?? '')}</p>
            <p class="hint">Values here override defaults only within this parent definition.</p>
            {#each nestedValues as leaf (leaf.pos)}
              <label>{leaf.label} ({leaf.type})
                <input aria-label={`Nested ${leaf.label} value`} value={leaf.value}
                  oninput={(event) => updateNestedValue(leaf, event.currentTarget.value)} />
              </label>
              {#if leaf.type === 'image'}
                <label>Image description
                  <input aria-label={`Nested ${leaf.label} alt`} value={leaf.alt ?? ''}
                    oninput={(event) => updateNestedValue(leaf, event.currentTarget.value, 'alt')} />
                </label>
              {/if}
            {/each}
            <button onclick={openNested}>Edit definition</button>
          {:else if selected.type === 'formula'}
            <label>Field <input value={String(selected.attrs.field ?? '')} oninput={(e) => updateAttr('field', e.currentTarget.value)}/></label>
          {:else if selected.type === 'image'}
            <label>Source <input value={String(selected.attrs.src ?? '')} oninput={(e) => updateAttr('src', e.currentTarget.value)}/></label>
          {/if}
          {#if selected.type !== 'customBlock'}
            <label>Classes <input value={String(selected.attrs.class ?? '')} oninput={(e) => updateAttr('class', e.currentTarget.value)} /></label>
          {/if}
          <button onclick={() => { if (selected && editor) { const n = editor.state.doc.nodeAt(selected.pos); if (n) editor.commands.deleteRange({ from: selected.pos, to: selected.pos + n.nodeSize }); syncStructure(); } }}>Delete selected</button>
        {/if}
      </aside>
      <section class="preview-pane">
        <div class="section-title">Live preview</div>
        <div class="preview sheet-content rbb-definition-preview" bind:this={canvas} onclick={selectNestedFromPreview}></div>
      </section>
      <section class="source-pane">
        {#if tab === 'structure'}
          <div class="source-actions"><strong>Definition JSON</strong><button onclick={syncStructure}>From preview</button><button onclick={applyJSON}>Apply JSON</button></div>
          <CodeEditor language="json" label="Custom block structure JSON" value={structure} onChange={(v) => { structure = v; jsonDraftEdited = true; }} />
        {:else}
          <div class="source-actions"><strong>Custom block CSS</strong></div>
          <CodeEditor language="css" label="Custom block CSS" value={css} onChange={(v) => css = v} />
        {/if}
      </section>
    </div>
    {#if error}<div role="alert" class="error">{error}</div>{/if}
    <footer><button onclick={close}>Cancel</button><button class="primary" onclick={save}>Save definition</button></footer>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: #1d2029b8; padding: 20px; }
  .modal { display: flex; flex-direction: column; width: min(1400px, 98vw); height: min(860px, 94vh); background: #fbfaf8; border-radius: 16px; overflow: hidden; box-shadow: 0 24px 85px #0007; color: #312d2a; }
  header, footer { display: flex; align-items: center; justify-content: space-between; padding: 15px 22px; border-bottom: 1px solid #dedad4; }
  header div { display: flex; flex-direction: column; gap: 2px; }
  header span { color: #8c8177; font: .73rem monospace; }
  .nav-actions { display: flex; gap: 8px; }
  .hint { font-size: .74rem; color: #796d61; }
  footer { justify-content: flex-end; gap: 10px; border-top: 1px solid #dedad4; border-bottom: 0; }
  button { border: 1px solid #d4c7b7; background: #fdfaf5; color: #5e4e3f; padding: 8px 11px; border-radius: 7px; cursor: pointer; }
  button.primary { background: #ddbd8c; color: #242526; font-weight: 800; }
  .properties { display: flex; gap: 15px; padding: 12px 22px; border-bottom: 1px solid #dedad4; }
  label { display: grid; gap: 5px; font-size: .73rem; font-weight: 700; }
  input { border: 1px solid #d8d2c9; padding: 7px; min-width: 150px; border-radius: 6px; }
  .toolbar { display: flex; gap: 15px; padding: 8px 22px; align-items: center; }
  .switch { display: flex; gap: 4px; padding: 3px; border-radius: 9px; background: #eae4db; }
  .switch button { border: 0; background: transparent; }
  .switch button.active { background: #ddbd8c; font-weight: 800; }
  .body { display: grid; grid-template-columns: 215px minmax(0, 1fr) minmax(300px, .9fr); flex: 1; min-height: 0; }
  .palette-pane { padding: 12px; border-right: 1px solid #dedad4; overflow: auto; }
  .palette-pane label { margin-top: 12px; }
  .section-title { font-size: .75rem; font-weight: 800; margin-bottom: 12px; }
  .preview-pane { padding: 18px; min-width: 0; overflow: auto; background: #f3efe8; }
  .preview { background: #fdfaf4; min-height: 300px; padding: 16px; border-radius: 10px; }
  .preview :global(.tiptap) { outline: none; min-height: 260px; }
  .source-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: white; }
  .source-actions { display: flex; align-items: center; gap: 5px; padding: 8px; border-bottom: 1px solid #dedad4; }
  .source-actions strong { margin-right: auto; font-size: .75rem; }
  .error { color: #a32a25; padding: 8px 22px; }
  @media (max-width: 900px) { .body { grid-template-columns: 180px minmax(0, 1fr); } .source-pane { grid-column: 1/-1; min-height: 220px; } }
</style>
