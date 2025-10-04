import type { Track } from '$lib/types';

export type LyricsKind = 'line' | 'word';

export interface LyricsSyllable {
	text: string;
	startTime: number;
	duration: number;
	romanizedText?: string;
	isBackground?: boolean;
}

export interface LyricsLine {
	text: string;
	startTime: number;
	endTime: number;
	duration: number;
	syllables?: LyricsSyllable[];
	romanizedText?: string;
	segments?: string[];
}

export interface LyricsPayload {
	kind: LyricsKind;
	lines: LyricsLine[];
	metadata: {
		title: string;
		artist: string;
		album?: string;
		duration?: number;
		source?: string;
	};
	raw?: unknown;
}

const KPOE_SERVERS = [
	'https://lyricsplus.prjktla.workers.dev',
	'https://lyrics-plus-backend.vercel.app',
	'https://lyricsplus.onrender.com',
	'https://lyricsplus.prjktla.online'
];

const MAX_KPOE_ATTEMPT_ROUNDS = 3;

const DEFAULT_SOURCE_ORDER = 'apple,lyricsplus,musixmatch,spotify,musixmatch-word';

function normaliseServerUrl(server: string): string {
	return server.endsWith('/') ? server.slice(0, -1) : server;
}

interface KpoeResponse {
	type?: string;
	lyrics?: Array<{
		text?: string;
		time?: number | string;
		duration?: number | string;
		syllabus?: Array<{
			text?: string;
			time?: number | string;
			duration?: number | string;
			isBackground?: boolean;
		}>;
		transliteration?: {
			text?: string;
			syllabus?: Array<{
				text?: string;
			}>;
		};
		element?: string[];
	}>;
	metadata?: {
		title?: string;
		artist?: string;
		album?: string;
		duration?: number;
		source?: string;
		ignoreSponsorblock?: boolean;
	};
	ignoreSponsorblock?: boolean;
}

export async function fetchYouLyLyrics(
	track: Track,
	options: { signal?: AbortSignal; forceReload?: boolean } = {}
): Promise<LyricsPayload | null> {
	const params = new URLSearchParams({
		title: track.title,
		artist: track.artist?.name ?? '',
		duration: String(Math.round(track.duration ?? 0))
	});

	if (track.album?.title) {
		params.append('album', track.album.title);
	}

	params.append('source', DEFAULT_SOURCE_ORDER);
	if (options.forceReload) {
		params.append('forceReload', 'true');
	}

	const normalisedServers = KPOE_SERVERS.map(normaliseServerUrl);

	for (let attempt = 0; attempt < MAX_KPOE_ATTEMPT_ROUNDS; attempt += 1) {
		for (const server of normalisedServers) {
			const url = `${server}/v2/lyrics/get?${params.toString()}`;
			try {
				const response = await fetch(url, {
					signal: options.signal,
					headers: {
						Accept: 'application/json'
					},
					cache: options.forceReload ? 'no-store' : 'default'
				});

				if (response.status === 404 || response.status === 403) {
					continue;
				}

				if (!response.ok) {
					console.warn(
						`YouLy+ server ${server} responded with ${response.status} (attempt ${attempt + 1})`
					);
					continue;
				}

				const json = (await response.json()) as KpoeResponse;
				const parsed = parseKpoePayload(json);
				if (parsed && parsed.lines.length > 0) {
					return parsed;
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') {
					throw error;
				}
				console.warn(`Failed to fetch lyrics from ${server} (attempt ${attempt + 1}):`, error);
			}
		}
	}

	const fallback = await fetchFromLRCLib(track, options.signal);
	if (fallback && fallback.lines.length > 0) {
		return fallback;
	}

	return null;
}

function parseKpoePayload(payload: KpoeResponse | undefined): LyricsPayload | null {
	if (!payload || !Array.isArray(payload.lyrics) || payload.lyrics.length === 0) {
		return null;
	}

	const kind: LyricsKind = payload.type?.toLowerCase() === 'word' ? 'word' : 'line';

	const lines: LyricsLine[] = payload.lyrics
		.map((entry) => {
			const startMs = Number(entry?.time ?? 0);
			const durationMs = Number(entry?.duration ?? 0);
			const startTime = Number.isFinite(startMs) ? startMs / 1000 : 0;
			const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
			const endTime = duration > 0 ? startTime + duration : startTime;

			const syllables: LyricsSyllable[] | undefined = Array.isArray(entry?.syllabus)
				? entry!.syllabus!.map((syl, index) => {
						const sylStartMs = Number(syl?.time ?? 0);
						const sylDurationMs = Number(syl?.duration ?? 0);
						const transliteration = entry?.transliteration?.syllabus?.[index]?.text;
						return {
							text: syl?.text ?? '',
							startTime: Number.isFinite(sylStartMs) ? sylStartMs / 1000 : startTime,
							duration: Number.isFinite(sylDurationMs) ? sylDurationMs / 1000 : 0,
							romanizedText: transliteration ?? undefined,
							isBackground: syl?.isBackground ?? false
						};
					})
				: undefined;

			const romanizedText = entry?.transliteration?.text;
			return {
				text: entry?.text ?? '',
				startTime,
				endTime,
				duration,
				syllables,
				romanizedText: romanizedText ?? undefined,
				segments: entry?.element ?? undefined
			};
		})
		.filter((line) => line.text.trim().length > 0);

	if (lines.length === 0) {
		return null;
	}

	return {
		kind,
		lines,
		metadata: {
			title: payload.metadata?.title ?? '',
			artist: payload.metadata?.artist ?? '',
			album: payload.metadata?.album ?? undefined,
			duration: payload.metadata?.duration,
			source: payload.metadata?.source ?? 'Lyrics+'
		},
		raw: payload
	};
}

interface LrcLibResponse {
	trackName?: string;
	artistName?: string;
	albumName?: string;
	duration?: number;
	syncedLyrics?: string;
}

async function fetchFromLRCLib(track: Track, signal?: AbortSignal): Promise<LyricsPayload | null> {
	const params = new URLSearchParams({
		artist_name: track.artist?.name ?? '',
		track_name: track.title
	});
	if (track.album?.title) {
		params.append('album_name', track.album.title);
	}

	const url = `https://lrclib.net/api/get?${params.toString()}`;

	try {
		const response = await fetch(url, {
			signal,
			headers: {
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			return null;
		}

		const json = (await response.json()) as LrcLibResponse;
		return parseLrcLibPayload(json);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		console.warn('LRCLib request failed:', error);
		return null;
	}
}

function parseLrcLibPayload(payload: LrcLibResponse | undefined): LyricsPayload | null {
	if (!payload?.syncedLyrics) {
		return null;
	}

	const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
	const parsedLines = payload.syncedLyrics
		.split('\n')
		.map((line) => {
			const match = lineRegex.exec(line);
			if (!match) return null;
			const minutes = Number(match[1] ?? 0);
			const seconds = Number(match[2] ?? 0);
			const fraction = match[3] ?? '0';
			const fractionValue = Number(fraction) / (fraction.length === 2 ? 100 : 1000);
			const startTime = minutes * 60 + seconds + fractionValue;
			return {
				text: match[4]?.trim() ?? '',
				startTime
			};
		})
		.filter(
			(entry): entry is { text: string; startTime: number } => !!entry && entry.text.length > 0
		);

	if (parsedLines.length === 0) {
		return null;
	}

	const lines: LyricsLine[] = parsedLines.map((line, index) => {
		const next = parsedLines[index + 1];
		const endTime = next ? next.startTime : line.startTime + 5;
		return {
			text: line.text,
			startTime: line.startTime,
			endTime,
			duration: Math.max(0, endTime - line.startTime)
		};
	});

	return {
		kind: 'line',
		lines,
		metadata: {
			title: payload.trackName ?? '',
			artist: payload.artistName ?? '',
			album: payload.albumName ?? undefined,
			duration: payload.duration,
			source: 'LRCLib'
		},
		raw: payload
	};
}
