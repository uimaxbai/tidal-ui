import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type RegionOption = 'auto' | 'us' | 'eu';

const STORAGE_KEY = 'tidal-ui.region';

const readInitialRegion = (): RegionOption => {
	if (!browser) {
		return 'auto';
	}

	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'us' || stored === 'eu' || stored === 'auto') {
		return stored;
	}

	return 'auto';
};

const createRegionStore = () => {
	const { subscribe, set, update } = writable<RegionOption>(readInitialRegion());

	if (browser) {
		subscribe((value) => {
			try {
				localStorage.setItem(STORAGE_KEY, value);
			} catch (error) {
				console.warn('Failed to persist region preference', error);
			}
		});

		window.addEventListener('storage', (event) => {
			if (event.key !== STORAGE_KEY) return;
			const value = event.newValue;
			if (value === 'us' || value === 'eu' || value === 'auto') {
				set(value);
			}
		});
	}

	return {
		subscribe,
		setRegion(value: RegionOption) {
			update(() => value);
		}
	};
};

export const regionStore = createRegionStore();
