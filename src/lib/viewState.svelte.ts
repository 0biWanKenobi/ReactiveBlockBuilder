import { createContext } from 'svelte';
import type { JsonPanel, Tab } from './types/shared';

export class ViewState {
	tab = $state<Tab>('sheet');
	json = $state<JsonPanel>(null);
}

export const [getViewState, setViewState] = createContext<ViewState>();
