import type { SvelteHTMLElements } from 'svelte/elements';

export type OpResult = { success: true; message?: string } | { success: false; message: string };

export type HtmlTag = keyof SvelteHTMLElements;

export type NativeProps<Tag extends HtmlTag> = SvelteHTMLElements[Tag];

export type Listen = <K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    capture?: boolean
) => void;


export type Tab = 'sheet' | 'JSON' | 'CSS'
export type JsonPanel = 'Document' | 'Formulas' | null