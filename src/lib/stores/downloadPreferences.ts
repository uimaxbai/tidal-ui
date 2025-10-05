import { writable } from 'svelte/store';

export type DownloadMode = 'individual' | 'zip' | 'csv';

interface DownloadPreferencesState {
	mode: DownloadMode;
}

const createDownloadPreferencesStore = () => {
	const { subscribe, update } = writable<DownloadPreferencesState>({ mode: 'individual' });

	return {
		subscribe,
		setMode(mode: DownloadMode) {
			update(() => ({ mode }));
		}
	};
};

export const downloadPreferencesStore = createDownloadPreferencesStore();
