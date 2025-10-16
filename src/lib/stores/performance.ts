import { derived, readable } from 'svelte/store';
import { browser } from '$app/environment';
import { userPreferencesStore } from './userPreferences';
import {
	detectPerformance,
	subscribeToPerformanceChanges,
	type PerformanceLevel
} from '$lib/utils/performance';

/**
 * Derived store that provides the effective performance level
 * based on user preference (auto/high/medium/low) and system capabilities
 */
export const detectedPerformanceLevel = readable<PerformanceLevel>('medium', (set) => {
	if (!browser) {
		set('medium');
		return;
	}

	set(detectPerformance());

	const unsubscribe = subscribeToPerformanceChanges((next) => {
		set(next);
	});

	return () => {
		unsubscribe();
	};
});

export const effectivePerformanceLevel = derived(
	[userPreferencesStore, detectedPerformanceLevel],
	([$prefs, detected]): PerformanceLevel => {
		if (!browser) {
			return 'medium';
		}

		if ($prefs.performanceMode === 'auto') {
			return detected;
		}

		return $prefs.performanceMode as PerformanceLevel;
	}
);

/**
 * Store that tracks if user prefers reduced motion
 */
export const reducedMotion = readable(false, (set) => {
	if (!browser) {
		return;
	}

	const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

	set(mediaQuery.matches);

	const handler = (e: MediaQueryListEvent) => {
		set(e.matches);
	};

	mediaQuery.addEventListener('change', handler);

	return () => {
		mediaQuery.removeEventListener('change', handler);
	};
});

/**
 * Derived store that determines if animations should be enabled
 */
export const animationsEnabled = derived(
	[effectivePerformanceLevel, reducedMotion],
	([$perfLevel, $reducedMotion]) => {
		if ($reducedMotion) {
			return false;
		}

		return $perfLevel !== 'low';
	}
);
