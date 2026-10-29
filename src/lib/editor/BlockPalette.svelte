<script lang="ts">
  import type { JSONContent } from '@tiptap/core';
  import type { CustomBlockDefinition } from '../custom-blocks/types.js';
  import { insertionSamples } from './nodes.js';

  let {
    customBlocks = [],
    draggable = false,
    onDragStart,
    onDragEnd,
    onEdit,
    onDelete
  }: {
    customBlocks?: CustomBlockDefinition[];
    draggable?: boolean;
    onDragStart: (event: DragEvent, block: JSONContent) => void;
    onDragEnd: () => void;
    onEdit?: (block: CustomBlockDefinition) => void;
    onDelete?: (block: CustomBlockDefinition) => void;
  } = $props();

  const stock = [
    { key: 'container', icon: '▦', title: 'Container' },
    { key: 'textBlock', icon: '¶', title: 'Text' },
    { key: 'formula', icon: 'ƒ', title: 'Formula' },
    { key: 'image', icon: '▧', title: 'Image' }
  ] as const;

  function instance(block: CustomBlockDefinition): JSONContent {
    return {
      type: 'customBlock',
      attrs: { typeId: block.typeId, instanceId: crypto.randomUUID(), nodeId: crypto.randomUUID() }
    };
  }
</script>

<div class="palette">
  {#each stock as entry (entry.key)}
    <button
      class="tile"
      draggable={draggable}
      ondragstart={(event) => onDragStart(event, structuredClone(insertionSamples[entry.key]))}
      ondragend={onDragEnd}
    ><span class="symbol">{entry.icon}</span>{entry.title}</button>
  {/each}
</div>

{#if customBlocks.length}
  <div class="heading">Custom blocks</div>
  <div class="palette">
    {#each customBlocks as definition (definition.typeId)}
      <div class="custom-tile">
        <button class="tile" draggable={draggable}
          ondragstart={(event) => onDragStart(event, instance(definition))}
          ondragend={onDragEnd}
        >
          <span class="symbol">◇</span>{definition.name}
        </button>
        {#if onEdit}
          <button class="edit" aria-label={`Edit ${definition.name}`}
            title={`Edit ${definition.name}`} onclick={() => onEdit?.(definition)}>✎</button>
        {/if}
        {#if onDelete}
          <button class="delete" aria-label={`Delete ${definition.name}`}
            title={`Delete ${definition.name}`} onclick={() => onDelete?.(definition)}>×</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .palette { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 9px; }
  .heading { color: #4c4034; text-transform: uppercase; letter-spacing: .09em; font-weight: 800; font-size: .72rem; margin-top: 22px; }
  .tile { width: 100%; min-height: 73px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 7px; padding: 12px 5px; border: 1px solid #ded6cb; background: white; border-radius: 9px; color: #4d463e; font-weight: 650; font-size: .75rem; cursor: pointer; }
  .tile:hover { border-color: #a9773c; }
  .tile[draggable="true"] { cursor: grab; }
  .symbol { font-family: Georgia, serif; font-size: 1.5rem; color: #936a3e; }
  .custom-tile { position: relative; min-width: 0; }
  .edit { position: absolute; right: 5px; top: 5px; border: 0; border-radius: 5px; color: #71543a; background: #f6e7cf; padding: 3px 6px; opacity: 0; cursor: pointer; }
  .custom-tile:hover .edit, .edit:focus-visible { opacity: 1; }
  .delete { position: absolute; right: 5px; bottom: 5px; border: 0; border-radius: 5px; color: #963d32; background: #fae4dd; padding: 2px 7px; opacity: 0; cursor: pointer; }
  .custom-tile:hover .delete, .delete:focus-visible { opacity: 1; }
</style>
