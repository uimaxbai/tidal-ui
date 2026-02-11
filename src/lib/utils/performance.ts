/**
 * Performance detection utilities (simplified - performance mode is global/low)
 * This file is deprecated and kept only for type exports for backward compatibility
 */

export type PerformanceLevel = 'low';

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') {
		return false;
	}

	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
