import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type DownloadMode = 'individual' | 'zip' | 'csv';

interface DownloadPreferencesState {
	mode: DownloadMode;
}

const createDownloadPreferencesStore = () => {
	const STORAGE_KEY = 'tidal-ui.downloadMode';

	const readInitialMode = (): DownloadMode => {
		if (!browser) {
			return 'individual';
		}

		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'individual' || stored === 'zip' || stored === 'csv') {
			return stored;
		}
		return 'individual';
	};

	const { subscribe, set, update } = writable<DownloadPreferencesState>({
		mode: readInitialMode()
	});

	if (browser) {
		window.addEventListener('storage', (event) => {
			if (event.key !== STORAGE_KEY) return;
			const value = event.newValue;
			if (value === 'individual' || value === 'zip' || value === 'csv') {
				set({ mode: value });
			}
		});
	}

	return {
		subscribe,
		setMode(mode: DownloadMode) {
			update(() => {
				if (browser) {
					try {
						localStorage.setItem(STORAGE_KEY, mode);
					} catch (error) {
						console.warn('Failed to persist download mode preference', error);
					}
				}
				return { mode };
			});
		}
	};
};

export const downloadPreferencesStore = createDownloadPreferencesStore();
