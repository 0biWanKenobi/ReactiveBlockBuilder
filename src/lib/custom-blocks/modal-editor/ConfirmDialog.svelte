<script lang="ts">
	import Dialog from '#lib/components/Dialog.svelte';

	export type DialogMode = 'replaceJSON' | 'replacePreview' | 'discardChanges';

	let {
		mode,
		open = $bindable(false),
		action
	}: { mode: DialogMode; open: boolean; action: (mode: DialogMode) => void } = $props();
	const cancelBtn = { text: 'Cancel' };

	const options = $derived.by(() => {
		switch (mode) {
			case 'replaceJSON':
				return {
					title: 'Replace your JSON draft?',
					message:
						'Your unapplied JSON edits will be discarded and replaced with the current preview. The preview will stay unchanged.',
					buttons: [
						cancelBtn,
						{
							text: 'Replace JSON draft',
							primary: true,
							danger: true,
							action: () => action('replaceJSON')
						}
					]
				};
			case 'replacePreview':
				return {
					title: 'Replace preview changes?',
					message:
						'The preview has changed since this JSON draft was created. Applying JSON will discard those preview changes, including any blocks you added.',
					buttons: [
						cancelBtn,
						{
							text: 'Replace preview',
							primary: true,
							danger: true,
							action: () => action('replacePreview')
						}
					]
				};
			case 'discardChanges':
				return {
					title: 'Discard unsaved changes?',
					message: 'Your changes to this definition will be lost if you leave the editor.',
					buttons: [
						cancelBtn,
						{
							text: 'Discard changes',
							primary: true,
							danger: true,
							action: () => action('discardChanges')
						}
					]
				};
			default: {
				return { title: '', message: '', buttons: [] };
			}
		}
	});
</script>

<Dialog bind:open title={options.title} message={options.message} buttons={options.buttons} />
