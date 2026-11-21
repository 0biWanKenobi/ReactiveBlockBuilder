import { initialFields, sampleDocument } from "#lib/sample.ts";
import { Editor } from "@tiptap/core";
import { createSheetExtensions } from "./nodes";
import type { Sheet } from "#lib";

const sheet = $state<Sheet>(structuredClone(initialFields));
// svelte-ignore state_referenced_locally
// capturing initial value is intentional
const editor = $state<Editor>(
		new Editor({
			editable: true,
			extensions: createSheetExtensions(sheet),
			content: sampleDocument,
			autofocus: false,
			editorProps: {
				attributes: { class: 'sheet-document', 'aria-label': 'Character sheet block editor' }
			}
		})
	);

export {editor, sheet}