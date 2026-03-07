import { readable } from 'svelte/store';
import { browser } from '$app/environment';

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
 * (always false since performance mode is global)
 */
export const animationsEnabled = readable(false);
