/**
 * Performance detection and optimization utilities
 */

export type PerformanceLevel = 'high' | 'medium' | 'low';

interface PerformanceMetrics {
	cpuCores: number;
	memory?: number; // GB
	connection?: string;
	gpu?: string;
}

/**
 * Detect device performance capabilities
 */
export function detectPerformance(): PerformanceLevel {
	if (typeof window === 'undefined') {
		return 'medium';
	}

	const metrics: PerformanceMetrics = {
		cpuCores: navigator.hardwareConcurrency || 4
	};

	// Check device memory (Chrome/Edge only)
	if ('deviceMemory' in navigator) {
		metrics.memory = (navigator as { deviceMemory?: number }).deviceMemory;
	}

	// Check connection speed
	if ('connection' in navigator) {
		const conn = (navigator as { connection?: { effectiveType?: string } }).connection;
		metrics.connection = conn?.effectiveType;
	}

	// Score the device
	let score = 0;

	// CPU scoring (0-3 points)
	if (metrics.cpuCores >= 8) {
		score += 3;
	} else if (metrics.cpuCores >= 4) {
		score += 2;
	} else if (metrics.cpuCores >= 2) {
		score += 1;
	}

	// Memory scoring (0-3 points)
	if (metrics.memory) {
		if (metrics.memory >= 8) {
			score += 3;
		} else if (metrics.memory >= 4) {
			score += 2;
		} else if (metrics.memory >= 2) {
			score += 1;
		}
	} else {
		// Assume medium if unknown
		score += 2;
	}

	// Connection scoring (0-2 points)
	if (metrics.connection) {
		if (metrics.connection === '4g' || metrics.connection === '5g') {
			score += 2;
		} else if (metrics.connection === '3g') {
			score += 1;
		}
	} else {
		// Assume medium if unknown
		score += 1;
	}

	// Total score range: 0-8
	// High: 6-8, Medium: 3-5, Low: 0-2
	if (score >= 6) {
		return 'high';
	} else if (score >= 3) {
		return 'medium';
	} else {
		return 'low';
	}
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') {
		return false;
	}

	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get optimal blur value based on performance level
 */
export function getOptimalBlur(defaultBlur: number, performanceLevel: PerformanceLevel): number {
	switch (performanceLevel) {
		case 'high':
			return defaultBlur;
		case 'medium':
			return Math.round(defaultBlur * 0.6);
		case 'low':
			return Math.round(defaultBlur * 0.3);
	}
}

/**
 * Get optimal saturation value based on performance level
 */
export function getOptimalSaturate(
	defaultSaturate: number,
	performanceLevel: PerformanceLevel
): number {
	switch (performanceLevel) {
		case 'high':
			return defaultSaturate;
		case 'medium':
			return Math.min(defaultSaturate, 130);
		case 'low':
			return 100; // No saturation boost
	}
}

/**
 * Check if animations should be enabled
 */
export function shouldEnableAnimations(performanceLevel: PerformanceLevel): boolean {
	if (prefersReducedMotion()) {
		return false;
	}

	return performanceLevel !== 'low';
}

/**
 * Get optimal number of gradient colors based on performance
 */
export function getOptimalGradientColors(performanceLevel: PerformanceLevel): number {
	switch (performanceLevel) {
		case 'high':
			return 5;
		case 'medium':
			return 3;
		case 'low':
			return 2;
	}
}
