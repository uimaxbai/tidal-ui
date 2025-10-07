import type { AudioQuality, Track } from '$lib/types';

const QUALITY_PRIORITY: readonly AudioQuality[] = [
	'HI_RES_LOSSLESS',
	'LOSSLESS',
	'HIGH',
	'LOW'
];

const QUALITY_TOKENS: Record<AudioQuality, readonly string[]> = {
	HI_RES_LOSSLESS: [
		'HI_RES_LOSSLESS',
		'HIRES_LOSSLESS',
		'HIRESLOSSLESS',
		'HIFI_PLUS',
		'HI_RES_FLAC',
		'HI_RES',
		'HIRES',
		'MASTER',
		'MASTER_QUALITY',
		'MQA'
	],
	LOSSLESS: ['LOSSLESS', 'HIFI'],
	HIGH: ['HIGH', 'HIGH_QUALITY'],
	LOW: ['LOW', 'LOW_QUALITY']
};

const QUALITY_RANK = new Map<AudioQuality, number>(
	QUALITY_PRIORITY.map((quality, index) => [quality, index])
);

const sanitizeToken = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');

export function normalizeQualityToken(value?: string | null): AudioQuality | null {
	if (!value) {
		return null;
	}

	const token = sanitizeToken(value);

	for (const [quality, aliases] of Object.entries(QUALITY_TOKENS) as Array<[
		AudioQuality,
		readonly string[]
	]>) {
		if (aliases.includes(token)) {
			return quality;
		}
	}

	return null;
}

export function deriveQualityFromTags(rawTags?: unknown): AudioQuality | null {
	if (!Array.isArray(rawTags)) {
		return null;
	}

	const candidates: AudioQuality[] = [];
	for (const tag of rawTags) {
		if (typeof tag !== 'string') {
			continue;
		}
		const normalized = normalizeQualityToken(tag);
		if (normalized && !candidates.includes(normalized)) {
			candidates.push(normalized);
		}
	}

	return pickBestQuality(candidates);
}

export function pickBestQuality(
	candidates: Array<AudioQuality | null | undefined>
): AudioQuality | null {
	let best: AudioQuality | null = null;

	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		if (!best) {
			best = candidate;
			continue;
		}
		const currentRank = QUALITY_RANK.get(candidate) ?? Number.POSITIVE_INFINITY;
		const bestRank = QUALITY_RANK.get(best) ?? Number.POSITIVE_INFINITY;
		if (currentRank < bestRank) {
			best = candidate;
		}
	}

	return best;
}

export function deriveTrackQuality(track?: Track | null): AudioQuality | null {
	if (!track) {
		return null;
	}

	const candidates: Array<AudioQuality | null> = [
		deriveQualityFromTags(track.mediaMetadata?.tags),
		deriveQualityFromTags(track.album?.mediaMetadata?.tags),
		normalizeQualityToken(track.audioQuality)
	];

	return pickBestQuality(candidates);
}
