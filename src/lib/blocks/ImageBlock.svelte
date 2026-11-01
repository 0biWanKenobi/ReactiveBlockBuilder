<script lang="ts">
	let { attrs }: { attrs: { src: string; alt: string } } = $props();
</script>

{#if attrs.src}
	<img class="rbb-image" src={attrs.src} alt={attrs.alt} draggable="false" />
{:else}
	<span class="rbb-empty-image">Image — choose a source in Properties</span>
{/if}
