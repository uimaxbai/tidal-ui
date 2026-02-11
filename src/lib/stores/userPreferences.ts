import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { AudioQuality } from '$lib/types';

export interface UserPreferencesState {
	playbackQuality: AudioQuality;
	convertAacToMp3: boolean;
	downloadCoversSeperately: boolean;
}

const STORAGE_KEY = 'tidal-ui.userPreferences';

const DEFAULT_STATE: UserPreferencesState = {
	playbackQuality: 'HI_RES_LOSSLESS',
	convertAacToMp3: false,
	downloadCoversSeperately: false
};

/**
 * Parse stored user preferences from JSON
 */
function parseStoredPreferences(raw: string | null): UserPreferencesState {
	if (!raw) {
		return DEFAULT_STATE;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<UserPreferencesState>;
		const quality = parsed?.playbackQuality;
		const convertFlag = parsed?.convertAacToMp3;
		const downloadCoversFlag = parsed?.downloadCoversSeperately;
		return {
			playbackQuality:
				quality === 'HI_RES_LOSSLESS' ||
				quality === 'LOSSLESS' ||
				quality === 'HIGH' ||
				quality === 'LOW'
					? quality
					: DEFAULT_STATE.playbackQuality,
			convertAacToMp3:
				typeof convertFlag === 'boolean' ? convertFlag : DEFAULT_STATE.convertAacToMp3,
			downloadCoversSeperately:
				typeof downloadCoversFlag === 'boolean'
					? downloadCoversFlag
					: DEFAULT_STATE.downloadCoversSeperately
		};
	} catch (error) {
		console.warn('Failed to parse stored user preferences', error);
		return DEFAULT_STATE;
	}
}

const readInitialPreferences = (): UserPreferencesState => {
	if (!browser) {
		return DEFAULT_STATE;
	}

	try {
		const storedRaw = localStorage.getItem(STORAGE_KEY);
		return parseStoredPreferences(storedRaw);
	} catch (error) {
		console.warn('Unable to read user preferences from storage', error);
		return DEFAULT_STATE;
	}
};

const createUserPreferencesStore = () => {
	const { subscribe, set, update } = writable<UserPreferencesState>(readInitialPreferences());

	if (browser) {
		subscribe((state) => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch (error) {
				console.warn('Failed to persist user preferences', error);
			}
		});

		window.addEventListener('storage', (event) => {
			if (event.key !== STORAGE_KEY) return;
			set(parseStoredPreferences(event.newValue));
		});
	}

	return {
		subscribe,
		setPlaybackQuality(quality: AudioQuality) {
			update((state) => {
				if (state.playbackQuality === quality) {
					return state;
				}
				return { ...state, playbackQuality: quality };
			});
		},
		setConvertAacToMp3(value: boolean) {
			update((state) => {
				if (state.convertAacToMp3 === value) {
					return state;
				}
				return { ...state, convertAacToMp3: value };
			});
		},
		toggleConvertAacToMp3() {
			update((state) => ({ ...state, convertAacToMp3: !state.convertAacToMp3 }));
		},
		setDownloadCoversSeperately(value: boolean) {
			update((state) => {
				if (state.downloadCoversSeperately === value) {
					return state;
				}
				return { ...state, downloadCoversSeperately: value };
			});
		},
		toggleDownloadCoversSeperately() {
			update((state) => ({ ...state, downloadCoversSeperately: !state.downloadCoversSeperately }));
		},
		reset() {
			set(DEFAULT_STATE);
		}
	};
};

export const userPreferencesStore = createUserPreferencesStore();
