/**
 * Performance detection and optimization utilities
 */

export type PerformanceLevel = 'high' | 'medium' | 'low';

type PerformanceListener = (level: PerformanceLevel) => void;

interface PerformanceMetrics {
	cpuCores: number;
	memory?: number; // GB
	connection?: string;
	gpu?: string;
}

const PERFORMANCE_PRIORITY: Record<PerformanceLevel, number> = {
	high: 3,
	medium: 2,
	low: 1
};

const DEBUG_NAMESPACE = '[tidal-ui] performance';

function debugLog(message: string, details?: unknown): void {
	if (typeof console === 'undefined') {
		return;
	}

	if (typeof details !== 'undefined') {
		console.info(DEBUG_NAMESPACE, message, details);
	} else {
		console.info(DEBUG_NAMESPACE, message);
	}
}

type GraphicsTier = 'advanced' | 'standard' | 'limited' | 'software' | 'none';

interface GraphicsAssessment {
	tier: GraphicsTier;
	renderer?: string;
	maxTextureSize?: number | null;
	shadingLanguage?: string | null;
	contextType?: 'webgl2' | 'webgl' | 'experimental-webgl';
	reason?: string;
}

const SOFTWARE_RENDERER_KEYWORDS = [
	'swiftshader',
	'llvmpipe',
	'softpipe',
	'software',
	'basic render driver',
	'angle (software',
	'mesa llvmpipe',
	'd3d11warp',
	'gdi generic'
];

function levelFromScore(score: number): PerformanceLevel {
	if (score >= 4) {
		return 'high';
	}

	if (score >= 1) {
		return 'medium';
	}

	return 'low';
}

function graphicsTierToLevel(tier: GraphicsTier): PerformanceLevel {
	switch (tier) {
		case 'advanced':
			return 'high';
		case 'standard':
			return 'medium';
		default:
			return 'low';
	}
}

function safeGetNumberParameter(
	context: WebGLRenderingContext | WebGL2RenderingContext,
	parameter: number
): number | null {
	try {
		const value = context.getParameter(parameter);
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	} catch (error) {
		debugLog('Failed to read WebGL numeric parameter', { parameter, error });
	}

	return null;
}

function extractGraphicsAssessment(
	context: WebGLRenderingContext | WebGL2RenderingContext,
	contextType: 'webgl2' | 'webgl' | 'experimental-webgl',
	usedFallback: boolean
): GraphicsAssessment {
	let renderer: string | undefined;
	let shadingLanguage: string | undefined;

	try {
		const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
		if (debugInfo) {
			renderer = context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string | undefined;
		} else {
			renderer = context.getParameter(context.RENDERER) as string | undefined;
		}
	} catch (error) {
		debugLog('Failed to read WebGL renderer info', error);
	}

	try {
		shadingLanguage = context.getParameter(context.SHADING_LANGUAGE_VERSION) as string | undefined;
	} catch (error) {
		debugLog('Failed to read WebGL shading language version', error);
	}

	const maxTextureSize = safeGetNumberParameter(context, context.MAX_TEXTURE_SIZE);
	const normalizedRenderer = renderer?.toLowerCase() ?? '';
	const isSoftwareRenderer = SOFTWARE_RENDERER_KEYWORDS.some((keyword) =>
		normalizedRenderer.includes(keyword)
	);

	let tier: GraphicsTier;
	let reason: string;

	if (isSoftwareRenderer) {
		tier = 'software';
		reason = 'Software renderer detected';
	} else if (usedFallback) {
		tier = 'limited';
		reason = 'WebGL context only available with major performance caveat';
	} else if (maxTextureSize !== null && maxTextureSize < 4096) {
		tier = 'limited';
		reason = 'Low max texture size';
	} else if (contextType === 'webgl2') {
		tier = 'advanced';
		reason = 'WebGL2 context available';
	} else {
		tier = 'standard';
		reason = 'WebGL context available';
	}

	const loseContextExt = context.getExtension('WEBGL_lose_context');
	loseContextExt?.loseContext();

	return {
		tier,
		reason,
		renderer,
		maxTextureSize,
		shadingLanguage,
		contextType
	};
}

const listeners = new Set<PerformanceListener>();
let cachedPerformanceLevel: PerformanceLevel | null = null;
let benchmarkInFlight: Promise<void> | null = null;
let pendingVisibilityBenchmark = false;

const DEFAULT_LEVEL: PerformanceLevel = 'medium';

function rank(level: PerformanceLevel): number {
	return PERFORMANCE_PRIORITY[level];
}

function pickConservativeLevel(a: PerformanceLevel, b: PerformanceLevel): PerformanceLevel {
	return rank(a) <= rank(b) ? a : b;
}

function notifyPerformanceLevel(level: PerformanceLevel): void {
	cachedPerformanceLevel = level;
	debugLog('Performance level updated', { level });

	for (const listener of listeners) {
		try {
			listener(level);
		} catch (error) {
			console.warn('Performance listener threw an error', error);
		}
	}

	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('tidal:performance-detected', { detail: level }));
	}
}

/**
 * Detect device performance capabilities
 */
export function detectPerformance(): PerformanceLevel {
	if (cachedPerformanceLevel) {
		debugLog('Using cached performance level', { level: cachedPerformanceLevel });
		scheduleBenchmark();
		return cachedPerformanceLevel;
	}

	const baseline = evaluateHardwareBaseline();
	debugLog('Baseline performance estimated', { baseline });
	notifyPerformanceLevel(baseline);
	scheduleBenchmark();
	return baseline;
}

export function subscribeToPerformanceChanges(listener: PerformanceListener): () => void {
	if (cachedPerformanceLevel) {
		listener(cachedPerformanceLevel);
	}

	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

function evaluateHardwareBaseline(): PerformanceLevel {
	if (typeof window === 'undefined') {
		return DEFAULT_LEVEL;
	}

	const metrics: PerformanceMetrics = {
		cpuCores: navigator.hardwareConcurrency || 4
	};

	if ('deviceMemory' in navigator) {
		metrics.memory = (navigator as { deviceMemory?: number }).deviceMemory;
	}

	if ('connection' in navigator) {
		const conn = (navigator as { connection?: { effectiveType?: string } }).connection;
		metrics.connection = conn?.effectiveType;
	}

	let score = 0;

	if (metrics.cpuCores >= 10) {
		score += 3;
	} else if (metrics.cpuCores >= 6) {
		score += 2;
	} else if (metrics.cpuCores >= 4) {
		score += 1;
	} else {
		score -= 1;
	}

	if (metrics.memory) {
		if (metrics.memory >= 12) {
			score += 3;
		} else if (metrics.memory >= 8) {
			score += 2;
		} else if (metrics.memory >= 4) {
			score += 1;
		} else if (metrics.memory < 3) {
			score -= 2;
		}
	} else {
		score += 1;
	}

	if (metrics.connection) {
		if (metrics.connection === '4g' || metrics.connection === '5g') {
			score += 1;
		} else if (metrics.connection === '2g') {
			score -= 2;
		} else if (metrics.connection === '3g') {
			score -= 1;
		}
	}

	if (metrics.cpuCores <= 2) {
		score -= 1.5;
	}

	const cpuLevel = levelFromScore(score);
	const graphics = assessGraphicsSupport();

	if (graphics.tier === 'none' || graphics.tier === 'software') {
		debugLog('Hardware baseline forced to low due to insufficient graphics support', {
			metrics,
			cpuScore: score,
			cpuLevel,
			graphics
		});
		return 'low';
	}

	const gpuLevel = graphicsTierToLevel(graphics.tier);
	const baseline = cpuLevel === 'low' || gpuLevel !== 'high' ? 'medium' : 'high';

	debugLog('Hardware baseline scored', {
		metrics,
		cpuScore: score,
		cpuLevel,
		gpuLevel,
		graphics,
		baseline
	});

	return baseline;
}

function scheduleBenchmark(): void {
	if (benchmarkInFlight) {
		debugLog('Graphics benchmark already running; skipping new request');
		return;
	}

	if (typeof window === 'undefined') {
		return;
	}

	if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
		if (!pendingVisibilityBenchmark) {
			pendingVisibilityBenchmark = true;
			debugLog('Deferring graphics benchmark until tab becomes visible');
			document.addEventListener(
				'visibilitychange',
				() => {
					pendingVisibilityBenchmark = false;
					debugLog('Tab visible; retrying deferred graphics benchmark');
					scheduleBenchmark();
				},
				{ once: true }
			);
		}
		return;
	}

	debugLog('Launching graphics benchmark to refine performance level');
	benchmarkInFlight = runGraphicsBenchmark()
		.then((result: PerformanceLevel | null) => {
			benchmarkInFlight = null;
			if (!result) {
				debugLog('Graphics benchmark produced no result; keeping current level');
				return;
			}

			const current = cachedPerformanceLevel ?? result;
			const finalLevel = pickConservativeLevel(current, result);
			if (cachedPerformanceLevel !== finalLevel) {
				notifyPerformanceLevel(finalLevel);
				debugLog('Performance level adjusted after benchmark', {
					initial: current,
					benchmark: result,
					final: finalLevel
				});
			} else {
				debugLog('Benchmark confirmed existing performance level', {
					initial: current,
					benchmark: result
				});
			}
		})
		.catch((error: unknown) => {
			benchmarkInFlight = null;
			debugLog('Graphics benchmark failed to run', error);
		});
}

function assessGraphicsSupport(): GraphicsAssessment {
	if (typeof document === 'undefined') {
		const assessment: GraphicsAssessment = {
			tier: 'limited',
			reason: 'Document unavailable for graphics probe'
		};
		debugLog('Graphics capability detected', assessment);
		return assessment;
	}

	let assessment: GraphicsAssessment = { tier: 'none', reason: 'Unable to acquire any WebGL context' };

	try {
		const canvas = document.createElement('canvas');
		const highPerfAttrs: WebGLContextAttributes = {
			powerPreference: 'high-performance',
			antialias: false
		};

		const gl2 = canvas.getContext('webgl2', highPerfAttrs) as WebGL2RenderingContext | null;
		if (gl2) {
			assessment = extractGraphicsAssessment(gl2, 'webgl2', false);
		} else {
			const strictAttrs: WebGLContextAttributes = {
				powerPreference: 'high-performance',
				antialias: false,
				failIfMajorPerformanceCaveat: true
			};
			const glStrict = canvas.getContext('webgl', strictAttrs) as WebGLRenderingContext | null;
			if (glStrict) {
				assessment = extractGraphicsAssessment(glStrict, 'webgl', false);
			} else {
				const fallback =
					(canvas.getContext('webgl', highPerfAttrs) as WebGLRenderingContext | null) ||
					(canvas.getContext('experimental-webgl', highPerfAttrs) as WebGLRenderingContext | null);
				if (fallback) {
					const contextType = fallback instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl';
					assessment = extractGraphicsAssessment(fallback, contextType, true);
				}
			}
		}
	} catch (error) {
		debugLog('Graphics probing failed', { error });
		assessment = {
			tier: 'limited',
			reason: 'Exception while probing graphics capabilities'
		};
	}

	debugLog('Graphics capability detected', assessment);
	return assessment;
}

function runGraphicsBenchmark(): Promise<PerformanceLevel | null> {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		debugLog('Skipping graphics benchmark: window or document unavailable');
		return Promise.resolve(null);
	}

	if (!('requestAnimationFrame' in window)) {
		debugLog('Skipping graphics benchmark: requestAnimationFrame unsupported');
		return Promise.resolve(null);
	}

	if (document.visibilityState === 'hidden') {
		debugLog('Skipping graphics benchmark: document hidden');
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		let isResolved = false;
		let summary: {
			averageFrame: number;
			worstFrame: number;
			averageWorkload: number;
			stutterRatio: number;
		} | null = null;
		const cleanup = (canvas?: HTMLCanvasElement) => {
			if (canvas && canvas.parentNode) {
				canvas.parentNode.removeChild(canvas);
			}
		};

		const failSafe = window.setTimeout(() => {
			if (!isResolved) {
				isResolved = true;
				debugLog('Graphics benchmark timed out; falling back to cached level');
				cleanup();
				resolve(null);
			}
		}, 1500);

		try {
			debugLog('Beginning graphics benchmark workload');
			const canvas = document.createElement('canvas');
			canvas.width = 640;
			canvas.height = 640;
			canvas.style.position = 'fixed';
			canvas.style.left = '-9999px';
			canvas.style.pointerEvents = 'none';
			canvas.style.opacity = '0';
			document.body.appendChild(canvas);

			const context = canvas.getContext('2d', {
				willReadFrequently: false,
				alpha: false
			});

			if (!context) {
				window.clearTimeout(failSafe);
				cleanup(canvas);
				debugLog('Canvas context unavailable; forcing low performance mode');
				resolve('low');
				return;
			}

			let seed = 7;
			const palette = ['#0f172a', '#1e293b', '#1d4ed8', '#2563eb', '#38bdf8'];

			const random = () => {
				seed = (seed * 1664525 + 1013904223) % 4294967296;
				return seed / 4294967296;
			};

			const frameTimes: number[] = [];
			const workloadTimes: number[] = [];
			const totalFrames = 60;
			let frameCount = 0;
			let lastTimestamp = 0;

			const renderWorkload = () => {
				const start = performance.now();
				context.globalCompositeOperation = 'lighter';
				context.clearRect(0, 0, canvas.width, canvas.height);
				for (let i = 0; i < 220; i += 1) {
					const size = 10 + ((i + frameCount) % 18) * 7;
					const x = random() * (canvas.width + size) - size;
					const y = random() * (canvas.height + size) - size;
					context.globalAlpha = 0.14 + ((i % 8) * 0.1);
					context.fillStyle = palette[i % palette.length]!;
					context.fillRect(x, y, size, size);
				}
				context.globalCompositeOperation = 'source-over';
				workloadTimes.push(performance.now() - start);
			};

			const finish = (result: PerformanceLevel | null) => {
				if (isResolved) return;
				isResolved = true;
				window.clearTimeout(failSafe);
				cleanup(canvas);
				debugLog('Graphics benchmark completed', { result, summary });
				resolve(result);
			};

			const step = (timestamp: number) => {
				if (frameCount > 0) {
					frameTimes.push(timestamp - lastTimestamp);
				}
				lastTimestamp = timestamp;

				renderWorkload();

				frameCount += 1;
				if (frameCount >= totalFrames) {
					const trimmedFrames = frameTimes.slice(5);
					if (!trimmedFrames.length) {
						finish(null);
						return;
					}

					const averageFrame = trimmedFrames.reduce((sum, value) => sum + value, 0) / trimmedFrames.length;
					const worstFrame = Math.max(...trimmedFrames);
					const averageWorkload = workloadTimes.reduce((sum, value) => sum + value, 0) / workloadTimes.length;
					const stutterRatio = trimmedFrames.filter((value) => value > 24).length / trimmedFrames.length;

					summary = {
						averageFrame,
						worstFrame,
						averageWorkload,
						stutterRatio
					};

					let benchmarkLevel: PerformanceLevel = 'high';
					if (averageFrame > 32 || worstFrame > 52 || averageWorkload > 16 || stutterRatio > 0.35) {
						benchmarkLevel = 'low';
					} else if (averageFrame > 24 || worstFrame > 40 || averageWorkload > 10 || stutterRatio > 0.22) {
						benchmarkLevel = 'medium';
					}

					finish(benchmarkLevel);
					return;
				}

				window.requestAnimationFrame(step);
			};

			window.requestAnimationFrame((initialTimestamp) => {
				lastTimestamp = initialTimestamp;
				window.requestAnimationFrame(step);
			});
		} catch (error) {
			console.warn('Graphics benchmark failed', error);
			window.clearTimeout(failSafe);
			cleanup();
			resolve(null);
		}
	});
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
