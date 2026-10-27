<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { json } from '@codemirror/lang-json';
  import { css } from '@codemirror/lang-css';

  let {
    value,
    language,
    label,
    onChange
  }: {
    value: string;
    language: 'json' | 'css';
    label: string;
    onChange: (next: string) => void;
  } = $props();

  let target: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = new EditorView({
      parent: target,
      doc: value,
      extensions: [
          basicSetup,
          language === 'css' ? css() : json(),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': {
              height: '250px',
              fontSize: '12px',
              backgroundColor: '#ffffff'
            },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': {
              padding: '10px 4px',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              lineHeight: '1.55'
            },
            '.cm-gutters': {
              backgroundColor: '#fbfaf8',
              borderRight: '1px solid #eee9e2',
              color: '#ac9e90'
            },
            '&.cm-focused': { outline: 'none' }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString());
            }
          })
        ]
    });
    view.contentDOM.setAttribute('aria-label', label);

    return () => {
      view?.destroy();
      view = undefined;
    };
  });

  // Keep programmatic imports, exports and formatting in sync without
  // replacing the editor contents on each keystroke.
  $effect(() => {
    const latest = value;
    if (view && view.state.doc.toString() !== latest) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: latest }
      });
    }
  });
</script>

<div class="code-editor" bind:this={target}></div>

<style>
  .code-editor { min-width: 0; }
  .code-editor :global(.cm-editor) { max-width: 100%; }
</style>
