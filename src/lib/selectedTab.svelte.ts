import { createContext } from 'svelte';
import type { Tab } from './types/shared';

export class SelectedTab {
	value = $state<Tab>('sheet');
}

export const [getSelectedTab, setSelectedTab] = createContext<SelectedTab>();
