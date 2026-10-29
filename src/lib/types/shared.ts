import type { SvelteHTMLElements } from "svelte/elements";

export type OpResult =
    | { success: true, message?: string }
    | { success: false, message: string }


export type HtmlTag = keyof SvelteHTMLElements;