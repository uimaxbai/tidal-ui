import { browser } from '$app/environment';
type ColorThiefModule = typeof import('colorthief');
	type ColorThiefConstructor = ColorThiefModule extends { default: infer D }
	? D extends new (...args: unknown[]) => unknown
		? D
		: ColorThiefModule extends new (...args: unknown[]) => unknown
			? ColorThiefModule
			: never
	: ColorThiefModule extends new (...args: unknown[]) => unknown
	? ColorThiefModule
	: never;
type ColorThiefInstance = InstanceType<ColorThiefConstructor>;

export interface RGBColor {
	red: number;
	green: number;
	blue: number;
}

export interface PaletteResult {
	dominant: RGBColor;
	accent: RGBColor;
	palette: RGBColor[];
}

const DEFAULT_COLOR: RGBColor = { red: 15, green: 23, blue: 42 };

const clamp = (value: number, min = 0, max = 255) => Math.min(max, Math.max(min, value));

const mix = (color: RGBColor, target: RGBColor, factor: number): RGBColor => ({
	red: clamp(Math.round(color.red + (target.red - color.red) * factor)),
	green: clamp(Math.round(color.green + (target.green - color.green) * factor)),
	blue: clamp(Math.round(color.blue + (target.blue - color.blue) * factor))
});

const distance = (a: RGBColor, b: RGBColor): number => {
	const dr = a.red - b.red;
	const dg = a.green - b.green;
	const db = a.blue - b.blue;
	return Math.sqrt(dr * dr + dg * dg + db * db);
};

const saturation = ({ red, green, blue }: RGBColor): number => {
	const r = red / 255;
	const g = green / 255;
	const b = blue / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === min) return 0;
	const l = (max + min) / 2;
	const d = max - min;
	return l > 0.5 ? d / (2 - max - min) : d / (max + min);
};

export const rgbToCss = ({ red, green, blue }: RGBColor, alpha?: number): string => {
	const r = Math.round(clamp(red));
	const g = Math.round(clamp(green));
	const b = Math.round(clamp(blue));

	if (alpha === undefined) {
		return `rgb(${r}, ${g}, ${b})`;
	}

	const normalizedAlpha = Math.min(Math.max(alpha, 0), 1);
	return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha.toFixed(3)})`;
};

export const lighten = (color: RGBColor, amount: number): RGBColor => mix(color, { red: 255, green: 255, blue: 255 }, amount);
export const darken = (color: RGBColor, amount: number): RGBColor => mix(color, { red: 0, green: 0, blue: 0 }, amount);

/**
 * Calculate relative luminance of a color (WCAG standard)
 * Returns a value between 0 (black) and 1 (white)
 */
const getLuminance = ({ red, green, blue }: RGBColor): number => {
	// Convert to sRGB
	const rsRGB = red / 255;
	const gsRGB = green / 255;
	const bsRGB = blue / 255;

	// Apply gamma correction
	const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
	const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
	const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

	// Calculate luminance
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Calculate contrast ratio between two colors (WCAG standard)
 * Returns a value between 1 and 21
 */
const getContrastRatio = (color1: RGBColor, color2: RGBColor): number => {
	const lum1 = getLuminance(color1);
	const lum2 = getLuminance(color2);
	const lighter = Math.max(lum1, lum2);
	const darker = Math.min(lum1, lum2);
	return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Ensure a color has sufficient contrast against white and grey text
 * Darkens the color if necessary to meet minimum contrast requirements
 */
export const ensureTextContrast = (color: RGBColor): RGBColor => {
	const WHITE: RGBColor = { red: 255, green: 255, blue: 255 };
	const GREY: RGBColor = { red: 156, green: 163, blue: 175 }; // ~gray-400
	
	const MIN_CONTRAST_WHITE = 4.5; // WCAG AA standard for normal text
	const MIN_CONTRAST_GREY = 3.0; // Slightly lower for grey text
	
	let adjustedColor = { ...color };
	let contrastWhite = getContrastRatio(adjustedColor, WHITE);
	let contrastGrey = getContrastRatio(adjustedColor, GREY);
	let attempts = 0;
	const MAX_ATTEMPTS = 20;
	
	// Darken the color until it meets contrast requirements
	while ((contrastWhite < MIN_CONTRAST_WHITE || contrastGrey < MIN_CONTRAST_GREY) && attempts < MAX_ATTEMPTS) {
		adjustedColor = darken(adjustedColor, 0.08);
		contrastWhite = getContrastRatio(adjustedColor, WHITE);
		contrastGrey = getContrastRatio(adjustedColor, GREY);
		attempts++;
	}
	
	return adjustedColor;
};

const FALLBACK_RESULT: PaletteResult = {
	dominant: DEFAULT_COLOR,
	accent: { red: 30, green: 64, blue: 175 },
	palette: [DEFAULT_COLOR]
};

const toRgbColor = (value: number[] | undefined | null): RGBColor => ({
	red: clamp(Math.round(value?.[0] ?? DEFAULT_COLOR.red)),
	green: clamp(Math.round(value?.[1] ?? DEFAULT_COLOR.green)),
	blue: clamp(Math.round(value?.[2] ?? DEFAULT_COLOR.blue))
});

const selectAccentColor = (dominant: RGBColor, candidates: RGBColor[]): RGBColor => {
	if (candidates.length === 0) {
		return dominant;
	}

	const vivid = candidates.filter((color) => saturation(color) > 0.2);
	const ranking = (vivid.length > 0 ? vivid : candidates).slice().sort((a, b) => distance(dominant, b) - distance(dominant, a));
	return ranking[0] ?? dominant;
};

let colorThiefPromise: Promise<ColorThiefInstance | null> | null = null;

const loadColorThief = async (): Promise<ColorThiefInstance | null> => {
	if (!browser) return null;
	if (!colorThiefPromise) {
		colorThiefPromise = (import('colorthief') as Promise<ColorThiefModule | { default: ColorThiefConstructor }>)
			.then((module) => {
				const ctor = (module as { default?: ColorThiefConstructor }).default ?? (module as ColorThiefConstructor);
				return new ctor();
			})
			.catch((error) => {
				console.warn('Failed to load Color Thief', error);
				return null;
			}) as Promise<ColorThiefInstance | null>;
	}
	return colorThiefPromise;
};

export async function extractPaletteFromImage(url: string, precision = 32): Promise<PaletteResult> {
	if (!browser) {
		return FALLBACK_RESULT;
	}

	const colorThief = await loadColorThief();
	if (!colorThief) {
		return FALLBACK_RESULT;
	}

	const image = new Image();
	image.crossOrigin = 'anonymous';
	image.decoding = 'async';

	const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
		image.onload = () => resolve(image);
		image.onerror = (event) => reject(event);
	});

	image.src = url;

	let loadedImage: HTMLImageElement;
	try {
		loadedImage = await loadPromise;
	} catch (error) {
		console.warn('Failed to load image for palette extraction', error);
		return FALLBACK_RESULT;
	}

	let paletteValues: number[][] = [];
	let dominantValue: number[] | undefined;
	const colorCount = 6;
	const quality = Math.max(1, Math.round(precision / 4));
	try {
		paletteValues = colorThief.getPalette(loadedImage, colorCount, quality) ?? [];
		dominantValue = paletteValues[0] ?? colorThief.getColor(loadedImage, quality);
	} catch (error) {
		console.warn('Color Thief failed to extract palette', error);
		return FALLBACK_RESULT;
	}

	const paletteColors = paletteValues.map((value) => toRgbColor(value));
	const dominant = toRgbColor(dominantValue);
	const accent = selectAccentColor(dominant, paletteColors.slice(1));

	return {
		dominant,
		accent,
		palette: paletteColors.length > 0 ? paletteColors : [dominant]
	};
}
