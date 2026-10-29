<script lang="ts">
  let { attrs }: { attrs: { src: string; alt: string } } = $props();
</script>

{#if attrs.src}
  <img src={attrs.src} alt={attrs.alt} draggable="false" />
{:else}
  <span class="rbb-empty-image">Image — choose a source in Properties</span>
{/if}

<style>
  img { display: block; max-width: 100%; height: auto; }
  .rbb-empty-image { display: inline-block; border: 1px dashed #bca88c; padding: 16px; color: #7c7165; font-size: .8rem; }
</style>
