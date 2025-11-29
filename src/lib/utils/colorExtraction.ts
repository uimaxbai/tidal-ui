/**
 * Color extraction and vibrancy calculation utilities for dynamic backgrounds
 */

export interface Color {
	r: number;
	g: number;
	b: number;
	a: number;
	saturation?: number;
	luminance?: number;
	vibrancy?: number;
}

/**
 * Calculate HSV saturation for a color
 */
export function calculateSaturation(color: Color): number {
	const r_norm = color.r / 255;
	const g_norm = color.g / 255;
	const b_norm = color.b / 255;
	const max = Math.max(r_norm, g_norm, b_norm);
	const min = Math.min(r_norm, g_norm, b_norm);
	const delta = max - min;

	if (delta < 0.00001 || max < 0.00001) return 0;
	return delta / max; // HSV saturation
}

/**
 * Calculate relative luminance (ITU-R BT.709)
 */
export function calculateLuminance(color: Color): number {
	// Convert to linear RGB
	const linearize = (v: number) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	};

	const r = linearize(color.r);
	const g = linearize(color.g);
	const b = linearize(color.b);

	// ITU-R BT.709 weights
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate vibrancy score (favors mid-luminance and high saturation)
 */
export function calculateVibrancy(color: Color): number {
	const saturation = color.saturation ?? calculateSaturation(color);
	const luminance = color.luminance ?? calculateLuminance(color);

	// Vibrancy formula: favor mid-luminance and high saturation
	const lumFactor = 1.0 - Math.abs(luminance - 0.5) * 1.8;
	return saturation * 0.5 + Math.max(0, lumFactor) * 0.5;
}

/**
 * Get average color from a canvas region, selecting most vibrant sample if significantly better
 */
export function getAverageColor(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number
): Color {
	const imageData = ctx.getImageData(x, y, w, h);
	const data = imageData.data;
	const samples: Color[] = [];

	let totalR = 0,
		totalG = 0,
		totalB = 0,
		totalA = 0;
	let count = 0;

	// Sample every pixel
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i]!;
		const g = data[i + 1]!;
		const b = data[i + 2]!;
		const a = data[i + 3]!;

		totalR += r;
		totalG += g;
		totalB += b;
		totalA += a;
		count++;

		const color: Color = { r, g, b, a };
		color.saturation = calculateSaturation(color);
		color.luminance = calculateLuminance(color);
		color.vibrancy = calculateVibrancy(color);

		samples.push(color);
	}

	// Calculate average color
	const avgColor: Color = {
		r: Math.round(totalR / count),
		g: Math.round(totalG / count),
		b: Math.round(totalB / count),
		a: Math.round(totalA / count)
	};
	avgColor.saturation = calculateSaturation(avgColor);
	avgColor.luminance = calculateLuminance(avgColor);
	avgColor.vibrancy = calculateVibrancy(avgColor);

	// Select most vibrant sample if 20% better than average
	let best = avgColor;
	for (const sample of samples) {
		if (sample.vibrancy! > best.vibrancy! * 1.2) {
			best = sample;
		}
	}

	return best;
}

/**
 * Extract color palette from image in a grid pattern
 */
export async function extractPaletteFromImage(
	imageUrl: string,
	gridWidth: number = 8,
	gridHeight: number = 5,
	stretchedWidth: number = 32,
	stretchedHeight: number = 18
): Promise<Color[]> {
	return new Promise((resolve, reject) => {
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = stretchedWidth;
		tempCanvas.height = stretchedHeight;
		const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

		if (!tempCtx) {
			reject(new Error('Failed to get canvas context'));
			return;
		}

		// Try CORS fetch first
		fetch(imageUrl, { mode: 'cors' })
			.then((response) => response.blob())
			.then((blob) => {
				const img = new Image();
				img.onload = () => {
					tempCtx.drawImage(img, 0, 0, stretchedWidth, stretchedHeight);
					const palette = extractPaletteFromCanvas(
						tempCtx,
						gridWidth,
						gridHeight,
						stretchedWidth,
						stretchedHeight
					);
					resolve(palette);
					URL.revokeObjectURL(img.src);
				};
				img.onerror = () => {
					reject(new Error('Failed to load image'));
					URL.revokeObjectURL(img.src);
				};
				img.src = URL.createObjectURL(blob);
			})
			.catch(() => {
				// Fallback to img.crossOrigin
				const img = new Image();
				img.crossOrigin = 'anonymous';
				img.onload = () => {
					tempCtx.drawImage(img, 0, 0, stretchedWidth, stretchedHeight);
					const palette = extractPaletteFromCanvas(
						tempCtx,
						gridWidth,
						gridHeight,
						stretchedWidth,
						stretchedHeight
					);
					resolve(palette);
				};
				img.onerror = () => reject(new Error('Failed to load image with CORS'));
				img.src = imageUrl;
			});
	});
}

/**
 * Extract palette from canvas context
 */
function extractPaletteFromCanvas(
	ctx: CanvasRenderingContext2D,
	gridWidth: number,
	gridHeight: number,
	canvasWidth: number,
	canvasHeight: number
): Color[] {
	const palette: Color[] = [];
	const cellW = canvasWidth / gridWidth;
	const cellH = canvasHeight / gridHeight;

	for (let j = 0; j < gridHeight; j++) {
		for (let i = 0; i < gridWidth; i++) {
			const x = Math.floor(i * cellW);
			const y = Math.floor(j * cellH);
			const color = getAverageColor(ctx, x, y, Math.ceil(cellW), Math.ceil(cellH));
			palette.push(color);
		}
	}

	return palette;
}

/**
 * RGB to HSL conversion
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (delta !== 0) {
		s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

		if (max === r) {
			h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
		} else if (max === g) {
			h = ((b - r) / delta + 2) / 6;
		} else {
			h = ((r - g) / delta + 4) / 6;
		}
	}

	return [h, s, l];
}

/**
 * HSL to RGB conversion
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};

	let r, g, b;

	if (s === 0) {
		r = g = b = l;
	} else {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Get most vibrant color from palette for lyrics highlighting
 */
export function getMostVibrantColor(
	palette: Color[],
	minLuminanceThreshold: number = 0.15
): Color {
	// Filter out very dark colors
	const filteredPalette = palette.filter(
		(color) => calculateLuminance(color) > minLuminanceThreshold
	);

	if (filteredPalette.length === 0) {
		// Fallback to brightest color if all are too dark
		return palette.reduce((prev, curr) =>
			calculateLuminance(curr) > calculateLuminance(prev) ? curr : prev
		);
	}

	// Sort by vibrancy and select best
	const selectedColor = filteredPalette.reduce((prev, curr) => {
		const prevVibrancy = prev.vibrancy ?? calculateVibrancy(prev);
		const currVibrancy = curr.vibrancy ?? calculateVibrancy(curr);
		return currVibrancy > prevVibrancy ? curr : prev;
	});

	// Convert to HSL and boost saturation by 20%
	const [h, s, l] = rgbToHsl(selectedColor.r, selectedColor.g, selectedColor.b);
	const increasedSaturation = Math.min(1.0, s * 1.2);
	const [r, g, b] = hslToRgb(h, increasedSaturation, l);

	return { r, g, b, a: selectedColor.a };
}
