import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type { AudioQuality } from '$lib/types';
import { type PerformanceLevel } from '$lib/utils/performance';

export type PerformanceMode = 'medium' | 'low';

export interface UserPreferencesState {
	playbackQuality: AudioQuality;
	convertAacToMp3: boolean;
	downloadCoversSeperately: boolean;
	performanceMode: PerformanceMode;
}

const STORAGE_KEY = 'tidal-ui.userPreferences';

const DEFAULT_STATE: UserPreferencesState = {
	playbackQuality: 'HI_RES_LOSSLESS',
	convertAacToMp3: false,
	downloadCoversSeperately: false,
	performanceMode: 'medium'
};

/**
 * Detect if the user is on a mobile/touch device for initial performance setting
 */
function detectIsMobileDevice(): boolean {
	if (!browser) return false;

	// Check for touch capability
	const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

	// Check screen size (typical mobile breakpoint)
	const isSmallScreen = window.innerWidth <= 768;

	// Check for mobile user agent patterns
	const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
		navigator.userAgent
	);

	return hasTouch && (isSmallScreen || mobileUA);
}

function parseStoredPreferences(raw: string | null): UserPreferencesState {
	if (!raw) {
		return DEFAULT_STATE;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<UserPreferencesState>;
		const quality = parsed?.playbackQuality;
		const convertFlag = parsed?.convertAacToMp3;
		const downloadCoversFlag = parsed?.downloadCoversSeperately;
		const perfMode = parsed?.performanceMode;
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
					: DEFAULT_STATE.downloadCoversSeperately,
			performanceMode:
				perfMode === 'medium' || perfMode === 'low' ? perfMode : DEFAULT_STATE.performanceMode
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

		// If no stored preferences, detect mobile and set appropriate defaults
		if (!storedRaw) {
			const isMobile = detectIsMobileDevice();
			const initialState: UserPreferencesState = {
				...DEFAULT_STATE,
				// Mobile devices default to 'medium' performance (already default)
				// Could set to 'low' for very resource-constrained devices if needed
				performanceMode: isMobile ? 'medium' : 'medium'
			};

			// Persist the initial preferences so this detection only runs once
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
			} catch {
				// Ignore storage errors
			}

			return initialState;
		}

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
		setPerformanceMode(mode: PerformanceMode) {
			update((state) => {
				if (state.performanceMode === mode) {
					return state;
				}
				return { ...state, performanceMode: mode };
			});
		},
		getEffectivePerformanceLevel(): PerformanceLevel {
			const state = readInitialPreferences();
			return state.performanceMode as PerformanceLevel;
		},
		reset() {
			set(DEFAULT_STATE);
		}
	};
};

export const userPreferencesStore = createUserPreferencesStore();
