// API service for HIFI API
import { API_CONFIG, fetchWithCORS, selectApiTargetForRegion } from './config';
import type { RegionOption } from '$lib/stores/region';
import { deriveTrackQuality } from '$lib/utils/audioQuality';
import { parseTidalUrl, type TidalUrlParseResult } from '$lib/utils/urlParser';
import { formatArtistsForMetadata } from '$lib/utils';
import type {
	Track,
	Artist,
	Album,
	Playlist,
	SearchResponse,
	AudioQuality,
	StreamData,
	CoverImage,
	Lyrics,
	TrackInfo,
	TrackLookup,
	ArtistDetails
} from './types';

const API_BASE = API_CONFIG.baseUrl;
const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';
export const DASH_MANIFEST_UNAVAILABLE_CODE = 'DASH_MANIFEST_UNAVAILABLE';

type CodedError = Error & { code?: string };

export type TrackDownloadProgress =
	| { stage: 'downloading'; receivedBytes: number; totalBytes?: number }
	| { stage: 'embedding'; progress: number };

export type DashManifestResult =
	| {
			kind: 'dash';
			manifest: string;
			contentType: string | null;
		}
	| {
			kind: 'flac';
			manifestText: string;
			urls: string[];
			contentType: string | null;
		};

export interface DashManifestWithMetadata {
	result: DashManifestResult;
	trackInfo: {
		sampleRate: number | null;
		bitDepth: number | null;
		replayGain: number | null;
	};
}

export interface DownloadTrackOptions {
	signal?: AbortSignal;
	onProgress?: (progress: TrackDownloadProgress) => void;
	onFfmpegCountdown?: (options: { totalBytes?: number; autoTriggered: boolean }) => void;
	onFfmpegStart?: () => void;
	onFfmpegProgress?: (progress: number) => void;
	onFfmpegComplete?: () => void;
	onFfmpegError?: (error: unknown) => void;
	ffmpegAutoTriggered?: boolean;
	convertAacToMp3?: boolean;
	downloadCoverSeperately?: boolean;
}

class LosslessAPI {
	public baseUrl: string;
	private metadataQueue: Promise<void> = Promise.resolve();

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
	}

	private resolveRegionalBase(region: RegionOption = 'auto'): string {
		try {
			const target = selectApiTargetForRegion(region);
			if (target?.baseUrl) {
				return target.baseUrl;
			}
		} catch (error) {
			console.warn('Falling back to default API base URL for region selection', { region, error });
		}
		return this.baseUrl;
	}

	private buildRegionalUrl(path: string, region: RegionOption = 'auto'): string {
		const base = this.resolveRegionalBase(region).replace(/\/+$/, '');
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		return `${base}${normalizedPath}`;
	}

	private normalizeSearchResponse<T>(
		data: unknown,
		key: 'tracks' | 'albums' | 'artists' | 'playlists'
	): SearchResponse<T> {
		const section = this.findSearchSection<T>(data, key, new Set());
		return this.buildSearchResponse<T>(section);
	}

	private buildSearchResponse<T>(
		section: Partial<SearchResponse<T>> | undefined
	): SearchResponse<T> {
		const items = section?.items;
		const list = Array.isArray(items) ? (items as T[]) : [];
		const limit = typeof section?.limit === 'number' ? section.limit : list.length;
		const offset = typeof section?.offset === 'number' ? section.offset : 0;
		const total =
			typeof section?.totalNumberOfItems === 'number' ? section.totalNumberOfItems : list.length;

		return {
			items: list,
			limit,
			offset,
			totalNumberOfItems: total
		};
	}

	private findSearchSection<T>(
		source: unknown,
		key: 'tracks' | 'albums' | 'artists' | 'playlists',
		visited: Set<object>
	): Partial<SearchResponse<T>> | undefined {
		if (!source) {
			return undefined;
		}

		if (Array.isArray(source)) {
			for (const entry of source) {
				const found = this.findSearchSection<T>(entry, key, visited);
				if (found) {
					return found;
				}
			}
			return undefined;
		}

		if (typeof source !== 'object') {
			return undefined;
		}

		const objectRef = source as Record<string, unknown>;
		if (visited.has(objectRef)) {
			return undefined;
		}
		visited.add(objectRef);

		if (!Array.isArray(source) && 'items' in objectRef && Array.isArray(objectRef.items)) {
			return objectRef as Partial<SearchResponse<T>>;
		}

		if (key in objectRef) {
			const nested = objectRef[key];
			const fromKey = this.findSearchSection<T>(nested, key, visited);
			if (fromKey) {
				return fromKey;
			}
		}

		for (const value of Object.values(objectRef)) {
			const found = this.findSearchSection<T>(value, key, visited);
			if (found) {
				return found;
			}
		}

		return undefined;
	}

	private prepareTrack(track: Track): Track {
		let normalized = track;
		if (!track.artist && Array.isArray(track.artists) && track.artists.length > 0) {
			normalized = { ...track, artist: track.artists[0]! };
		}

		const derivedQuality = deriveTrackQuality(normalized);
		if (derivedQuality && normalized.audioQuality !== derivedQuality) {
			normalized = { ...normalized, audioQuality: derivedQuality };
		}

		return normalized;
	}

	private prepareAlbum(album: Album): Album {
		if (!album.artist && Array.isArray(album.artists) && album.artists.length > 0) {
			return { ...album, artist: album.artists[0]! };
		}
		return album;
	}

	private prepareArtist(artist: Artist): Artist {
		if (!artist.type && Array.isArray(artist.artistTypes) && artist.artistTypes.length > 0) {
			return { ...artist, type: artist.artistTypes[0]! } as Artist;
		}
		return artist;
	}

	private ensureNotRateLimited(response: Response): void {
		if (response.status === 429) {
			throw new Error(RATE_LIMIT_ERROR_MESSAGE);
		}
	}

	private async delay(ms: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, ms));
	}

	private parseTrackLookup(data: unknown): TrackLookup {
		const entries = Array.isArray(data) ? data : [data];
		let track: Track | undefined;
		let info: TrackInfo | undefined;
		let originalTrackUrl: string | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;
			if (!track && 'album' in entry && 'artist' in entry && 'duration' in entry) {
				track = entry as Track;
				continue;
			}
			if (!info && 'manifest' in entry) {
				info = entry as TrackInfo;
				continue;
			}
			if (!originalTrackUrl && 'OriginalTrackUrl' in entry) {
				const candidate = (entry as { OriginalTrackUrl?: unknown }).OriginalTrackUrl;
				if (typeof candidate === 'string') {
					originalTrackUrl = candidate;
				}
			}
		}

		if (!track || !info) {
			throw new Error('Malformed track response');
		}

		return { track, info, originalTrackUrl };
	}

	private extractStreamUrlFromManifest(manifest: string): string | null {
		try {
			const decoded = this.decodeBase64Manifest(manifest);
			try {
				const parsed = JSON.parse(decoded) as { urls?: string[] };
				if (parsed && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
					return parsed.urls[0] ?? null;
				}
			} catch (jsonError) {
				// Ignore JSON parse failure and fall back to regex/XML search
				console.debug('Manifest JSON parse failed, falling back to pattern match', jsonError);
			}

			// If this is a segmented DASH manifest, don't extract a URL - let it fall through to segment download
			if (this.isSegmentedDashManifest(decoded)) {
				return null;
			}

			const mpdUrl = this.parseFlacUrlFromMpd(decoded);
			if (mpdUrl) {
				return mpdUrl;
			}

			// Match all URLs and filter out schema/namespace URLs and segment URLs
			const urlRegex = /https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/g;
			let match: RegExpExecArray | null;
			while ((match = urlRegex.exec(decoded)) !== null) {
				const url = match[0];
				// Skip segment template URLs and initialization segments
				if (url.includes('$Number$')) continue;
				if (/\/\d+\.mp4/.test(url)) continue; // Skip segment files like /0.mp4, /1.mp4, etc.
				if (this.isValidMediaUrl(url)) {
					return url;
				}
			}
			return null;
		} catch (error) {
			console.error('Failed to decode manifest:', error);
			return null;
		}
	}

	private isSegmentedDashManifest(decoded: string): boolean {
		// Check if manifest contains SegmentTemplate which indicates segmented content
		return /<SegmentTemplate/i.test(decoded);
	}

	private isDashManifestPayload(payload: string, contentType: string | null): boolean {
		const trimmed = payload.trim();
		if (!trimmed) {
			return false;
		}
		if (contentType && contentType.toLowerCase().includes('xml')) {
			return trimmed.startsWith('<');
		}
		return /^<\?xml/i.test(trimmed) || /^<MPD[\s>]/i.test(trimmed) || /^<\w+/i.test(trimmed);
	}

	private parseJsonSafely<T>(payload: string): T | null {
		try {
			return JSON.parse(payload) as T;
		} catch (error) {
			console.debug('Failed to parse JSON payload from DASH response', error);
			return null;
		}
	}

	private createDashUnavailableError(message: string): CodedError {
		const error = new Error(message) as CodedError;
		error.code = DASH_MANIFEST_UNAVAILABLE_CODE;
		return error;
	}

	private isXmlContentType(contentType: string | null): boolean {
		if (!contentType) return false;
		return /(application|text)\/(?:.+\+)?xml/i.test(contentType) || /dash\+xml|mpd/i.test(contentType);
	}

	private isJsonContentType(contentType: string | null): boolean {
		if (!contentType) return false;
		return /json/i.test(contentType) || /application\/vnd\.tidal\.bts/i.test(contentType);
	}

	private extractUrlsFromDashJsonPayload(payload: unknown): string[] {
		if (!payload || typeof payload !== 'object') {
			return [];
		}

		const candidate = (payload as { urls?: unknown }).urls;
		if (!Array.isArray(candidate)) {
			return [];
		}

		return candidate
			.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
			.filter((entry) => entry.length > 0);
	}

	private isHiResQuality(quality: AudioQuality | string): boolean {
		return String(quality).toUpperCase() === 'HI_RES_LOSSLESS';
	}

	private isV2ApiContainer(payload: unknown): payload is { version?: unknown; data?: unknown } {
		return Boolean(
			payload &&
			typeof payload === 'object' &&
			'version' in (payload as Record<string, unknown>) &&
			(payload as { version?: unknown }).version === '2.0'
		);
	}

	private decodeBase64Manifest(manifest: string): string {
		if (typeof manifest !== 'string') return '';
		const trimmed = manifest.trim();
		if (!trimmed) return '';
		try {
			// Support URL-safe base64 and missing padding
			const normalized = (() => {
				let value = trimmed.replace(/-/g, '+').replace(/_/g, '/');
				const pad = value.length % 4;
				if (pad === 2) value += '==';
				if (pad === 3) value += '=';
				return value;
			})();
			const decoded = atob(normalized);
			return decoded || trimmed;
		} catch {
			return trimmed;
		}
	}

	private extractTrackFromPayload(payload: unknown): Track | undefined {
		const candidates: unknown[] = [];
		if (!payload) return undefined;
		if (Array.isArray(payload)) {
			candidates.push(...payload);
		} else if (typeof payload === 'object') {
			candidates.push(payload);
			for (const value of Object.values(payload as Record<string, unknown>)) {
				if (value && (typeof value === 'object' || Array.isArray(value))) {
					candidates.push(value);
				}
			}
		}

		const isTrackLike = (entry: unknown): entry is Track => {
			if (!entry || typeof entry !== 'object') return false;
			const record = entry as Record<string, unknown>;
			return (
				typeof record.id === 'number' &&
				typeof record.title === 'string' &&
				typeof record.duration === 'number'
			);
		};

		for (const candidate of candidates) {
			if (isTrackLike(candidate)) {
				return candidate as Track;
			}
		}
		return undefined;
	}

	private async fetchTrackMetadata(trackId: number, apiVersion: 'v1' | 'v2' = 'v1'): Promise<Track> {
		const response = await this.fetch(`${this.baseUrl}/info/?id=${trackId}`, { apiVersion });
		this.ensureNotRateLimited(response);
		if (!response.ok) {
			throw new Error('Failed to fetch track metadata');
		}
		const payload = await response.json();
		const data = this.isV2ApiContainer(payload) ? payload.data : payload;
		const track = this.extractTrackFromPayload(data);
		if (!track) {
			throw new Error('Track metadata not found');
		}
		return this.prepareTrack(track);
	}

	private buildTrackInfoFromV2(data: Record<string, unknown>, fallbackTrackId: number): TrackInfo {
		const manifestMimeType =
			typeof data.manifestMimeType === 'string' && data.manifestMimeType.trim().length > 0
				? data.manifestMimeType
				: 'application/dash+xml';

		return {
			trackId: typeof data.trackId === 'number' ? data.trackId : fallbackTrackId,
			audioMode: typeof data.audioMode === 'string' ? data.audioMode : 'STEREO',
			audioQuality: typeof data.audioQuality === 'string' ? data.audioQuality : 'LOSSLESS',
			manifest: typeof data.manifest === 'string' ? data.manifest : '',
			manifestMimeType,
			manifestHash: typeof data.manifestHash === 'string' ? data.manifestHash : undefined,
			assetPresentation:
				typeof data.assetPresentation === 'string' ? data.assetPresentation : 'FULL',
			albumReplayGain:
				typeof data.albumReplayGain === 'number' ? data.albumReplayGain : undefined,
			albumPeakAmplitude:
				typeof data.albumPeakAmplitude === 'number' ? data.albumPeakAmplitude : undefined,
			trackReplayGain:
				typeof data.trackReplayGain === 'number' ? data.trackReplayGain : undefined,
			trackPeakAmplitude:
				typeof data.trackPeakAmplitude === 'number' ? data.trackPeakAmplitude : undefined,
			bitDepth: typeof data.bitDepth === 'number' ? data.bitDepth : undefined,
			sampleRate: typeof data.sampleRate === 'number' ? data.sampleRate : undefined
		};
	}

	private extractOriginalTrackUrl(payload: Record<string, unknown>): string | undefined {
		const originalUrl =
			typeof payload.OriginalTrackUrl === 'string'
				? payload.OriginalTrackUrl
				: typeof payload.originalTrackUrl === 'string'
					? payload.originalTrackUrl
					: undefined;
		return originalUrl;
	}

	private async parseTrackLookupV2(
		trackId: number,
		payload: { data?: unknown },
		apiVersion: 'v1' | 'v2' = 'v1'
	): Promise<TrackLookup> {
		const container = (payload?.data ?? payload) as Record<string, unknown>;
		const trackInfo = this.buildTrackInfoFromV2(container, trackId);
		let track = this.extractTrackFromPayload(container) ?? null;
		if (!track) {
			track = await this.fetchTrackMetadata(trackId, apiVersion);
		}

		return {
			track: this.prepareTrack(track),
			info: trackInfo,
			originalTrackUrl: this.extractOriginalTrackUrl(container)
		};
	}

	private buildDashManifestResult(payload: string, contentType: string | null): DashManifestResult {
		const manifestText = this.decodeBase64Manifest(payload);

		if (this.isXmlContentType(contentType) || this.isDashManifestPayload(manifestText, contentType)) {
			return { kind: 'dash', manifest: manifestText, contentType };
		}

		const trimmed = manifestText.trim();
		if (this.isJsonContentType(contentType) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
			const parsed = this.parseJsonSafely<{ detail?: unknown; urls?: unknown }>(manifestText);
			if (
				parsed &&
				typeof parsed === 'object' &&
				parsed.detail &&
				typeof parsed.detail === 'string' &&
				parsed.detail.toLowerCase() === 'not found'
			) {
				throw this.createDashUnavailableError('Dash manifest not found for track');
			}
			const urls = this.extractUrlsFromDashJsonPayload(parsed);
			if (urls.length > 0) {
				return { kind: 'flac', manifestText, urls, contentType };
			}
		}

		if (this.isDashManifestPayload(manifestText, contentType)) {
			return { kind: 'dash', manifest: manifestText, contentType };
		}

		const parsed = this.parseJsonSafely(manifestText);
		const urls = this.extractUrlsFromDashJsonPayload(parsed);
		if (urls.length > 0) {
			return { kind: 'flac', manifestText, urls, contentType };
		}

		throw this.createDashUnavailableError('Received unexpected payload from dash endpoint.');
	}

	private isValidMediaUrl(url: string): boolean {
		if (!url) return false;
		const normalized = url.toLowerCase();
		// Filter out XML schema/namespace URLs
		if (normalized.includes('w3.org')) return false;
		if (normalized.includes('xmlschema')) return false;
		if (normalized.includes('xmlns')) return false;
		// Must look like a media URL (has extension or query params suggesting media)
		if (normalized.includes('.flac') || normalized.includes('.mp4') || 
		    normalized.includes('.m4a') || normalized.includes('.aac') ||
		    normalized.includes('token=') || normalized.includes('/audio/')) {
			return true;
		}
		// If it has a file-like path segment, it's likely valid
		if (/\/[^/]+\.[a-z0-9]{2,5}(\?|$)/i.test(url)) return true;
		// If it's a relative path starting with a segment name, likely valid
		if (/^[a-z0-9_-]+\//i.test(url)) return true;
		// If it ends with a path segment that could be a file
		if (/\/[a-z0-9_-]+$/i.test(url)) return true;
		return false;
	}

	private parseFlacUrlFromMpd(manifestText: string): string | null {
		const trimmed = manifestText.trim();
		if (!trimmed) return null;

		const isValidMediaUrl = this.isValidMediaUrl.bind(this);

		const scoreUrl = (url: string | undefined | null): number => {
			if (!url) return -1;
			const normalized = url.toLowerCase();
			let score = 0;
			if (normalized.includes('flac')) score += 3;
			if (normalized.includes('hires')) score += 1;
			if (normalized.endsWith('.flac')) score += 4;
			if (normalized.includes('token=')) score += 1;
			return score;
		};

		const pickBest = (urls: Array<string | undefined | null>): string | null => {
			const candidates = urls
				.map((u) => (typeof u === 'string' ? u.trim() : ''))
				.filter((u) => u.length > 0 && isValidMediaUrl(u));
			if (candidates.length === 0) return null;
			return candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a))[0] ?? null;
		};

		// Prefer DOMParser when available (browser side)
		if (typeof DOMParser !== 'undefined') {
			try {
				const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
				const baseUrls = Array.from(doc.getElementsByTagName('BaseURL')).map((n) => n.textContent?.trim() ?? '');
				if (baseUrls.length > 0) {
					const best = pickBest(baseUrls);
					if (best) return best;
				}

				const reps = Array.from(doc.getElementsByTagName('Representation'));
				for (const rep of reps) {
					const codecs = rep.getAttribute('codecs')?.toLowerCase() ?? '';
					const base = Array.from(rep.getElementsByTagName('BaseURL')).map((n) => n.textContent?.trim() ?? '');
					if (base.length > 0 && codecs.includes('flac')) {
						const best = pickBest(base);
						if (best) return best;
					}
				}
			} catch (error) {
				console.debug('Failed to parse MPD manifest via DOMParser', error);
			}
		}

		// Regex fallback for SSR / non-browser
		const baseUrlMatch = trimmed.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
		if (baseUrlMatch?.[1]) {
			const candidate = baseUrlMatch[1].trim();
			if (isValidMediaUrl(candidate)) {
				return candidate;
			}
		}

		return null;
	}

	private parseMpdSegmentTemplate(
		manifestText: string
	):
		| {
				initializationUrl: string;
				mediaUrlTemplate: string;
				startNumber: number;
				segmentTimeline: Array<{ duration: number; repeat: number }>;
				baseUrl?: string;
				codec?: string;
			}
		| null {
		const trimmed = manifestText.trim();
		if (!trimmed) return null;

		const parseWithDom = () => {
			if (typeof DOMParser === 'undefined') return null;
			try {
				const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
				const rawBaseUrl = doc.getElementsByTagName('BaseURL')[0]?.textContent?.trim();
				// Filter out schema/namespace URLs
				const baseUrl = rawBaseUrl && this.isValidMediaUrl(rawBaseUrl) ? rawBaseUrl : undefined;

				let template: Element | null = null;
				let codec: string | undefined;

				const representations = Array.from(doc.getElementsByTagName('Representation'));
				for (const rep of representations) {
					const candidateTemplate = rep.getElementsByTagName('SegmentTemplate')[0];
					if (!candidateTemplate) continue;
					const codecsAttr = rep.getAttribute('codecs')?.toLowerCase() ?? '';
					if (!template || codecsAttr.includes('flac')) {
						template = candidateTemplate;
						codec = codecsAttr || undefined;
						if (codecsAttr.includes('flac')) break;
					}
				}

				if (!template) {
					template = doc.getElementsByTagName('SegmentTemplate')[0] ?? null;
				}

				if (!template) return null;

				const initializationUrl = template.getAttribute('initialization')?.trim();
				const mediaUrlTemplate = template.getAttribute('media')?.trim();
				if (!initializationUrl || !mediaUrlTemplate) return null;

				const startNumber = Number.parseInt(template.getAttribute('startNumber') ?? '1', 10);
				const timelineParent = template.getElementsByTagName('SegmentTimeline')[0];
				const segmentTimeline: Array<{ duration: number; repeat: number }> = [];
				if (timelineParent) {
					const segments = timelineParent.getElementsByTagName('S');
					for (const seg of Array.from(segments)) {
						const duration = Number.parseInt(seg.getAttribute('d') ?? '0', 10);
						if (!Number.isFinite(duration) || duration <= 0) continue;
						const repeat = Number.parseInt(seg.getAttribute('r') ?? '0', 10);
						segmentTimeline.push({ duration, repeat: Number.isFinite(repeat) ? repeat : 0 });
					}
				}

				return {
					initializationUrl,
					mediaUrlTemplate,
					startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
					segmentTimeline,
					baseUrl,
					codec
				};
			} catch (error) {
				console.debug('Failed to parse MPD manifest with DOMParser', error);
				return null;
			}
		};

		const parseWithRegex = () => {
			const initializationUrl = /initialization="([^"]+)"/i.exec(trimmed)?.[1]?.trim();
			const mediaUrlTemplate = /media="([^"]+)"/i.exec(trimmed)?.[1]?.trim();
			if (!initializationUrl || !mediaUrlTemplate) return null;
			const startNumberMatch = /startNumber="(\d+)"/i.exec(trimmed);
			const startNumber = startNumberMatch ? Number.parseInt(startNumberMatch[1]!, 10) : 1;
			const segmentTimeline: Array<{ duration: number; repeat: number }> = [];
			// Match <S> elements with d attribute, r attribute is optional
			const timelineRegex = /<S[^>]*\sd="(\d+)"(?:[^>]*\sr="(-?\d+)")?[^>]*\/?>/gi;
			let match: RegExpExecArray | null;
			while ((match = timelineRegex.exec(trimmed)) !== null) {
				const duration = Number.parseInt(match[1]!, 10);
				const repeat = match[2] ? Number.parseInt(match[2], 10) : 0;
				if (Number.isFinite(duration) && duration > 0) {
					segmentTimeline.push({ duration, repeat: Number.isFinite(repeat) ? repeat : 0 });
				}
			}

			return {
				initializationUrl,
				mediaUrlTemplate,
				startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
				segmentTimeline
			};
		};

		return parseWithDom() ?? parseWithRegex();
	}

	private buildMpdSegmentUrls(
		template:
			| {
					initializationUrl: string;
					mediaUrlTemplate: string;
					startNumber: number;
					segmentTimeline: Array<{ duration: number; repeat: number }>;
					baseUrl?: string;
					codec?: string;
				}
			| null
	): { initializationUrl: string; segmentUrls: string[] } | null {
		if (!template) return null;

		const resolveUrl = (url: string): string => {
			if (/^https?:\/\//i.test(url)) return url;
			if (template.baseUrl) {
				try {
					return new URL(url, template.baseUrl).toString();
				} catch {
					return `${template.baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
				}
			}
			return url;
		};

		const initializationUrl = resolveUrl(template.initializationUrl);
		const segmentUrls: string[] = [];
		let segmentNumber = template.startNumber;
		const timeline = template.segmentTimeline.length > 0 ? template.segmentTimeline : [{ duration: 0, repeat: 0 }];

		for (const entry of timeline) {
			const repeat = Number.isFinite(entry.repeat) ? entry.repeat : 0;
			const count = Math.max(1, repeat + 1);
			for (let i = 0; i < count; i += 1) {
				const url = template.mediaUrlTemplate.replace('$Number$', `${segmentNumber}`);
				segmentUrls.push(resolveUrl(url));
				segmentNumber += 1;
			}
		}

		return { initializationUrl, segmentUrls };
	}

	private async downloadFlacFromMpd(
		manifestText: string,
		options?: DownloadTrackOptions
	): Promise<{ blob: Blob; mimeType: string } | null> {
		const template = this.parseMpdSegmentTemplate(manifestText);
		const segments = this.buildMpdSegmentUrls(template);
		if (!segments) return null;

		const urls = [segments.initializationUrl, ...segments.segmentUrls];
		const chunks: Uint8Array[] = [];
		let receivedBytes = 0;

		for (const url of urls) {
			const response = await this.fetch(url, { signal: options?.signal });
			if (!response.ok) {
				throw new Error(`Failed to fetch DASH segment (status ${response.status})`);
			}
			const buffer = await response.arrayBuffer();
			const chunk = new Uint8Array(buffer);
			receivedBytes += chunk.byteLength;
			chunks.push(chunk);
			options?.onProgress?.({ stage: 'downloading', receivedBytes, totalBytes: undefined });
		}

		const totalBytes = chunks.reduce((total, current) => total + current.byteLength, 0);
		const merged = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.byteLength;
		}

		return { blob: new Blob([merged], { type: 'audio/flac' }), mimeType: 'audio/flac' };
	}

	private async resolveHiResStreamFromDash(trackId: number): Promise<string> {
		const manifest = await this.getDashManifest(trackId, 'HI_RES_LOSSLESS');
		if (manifest.kind === 'flac') {
			const url = manifest.urls.find((candidate) => typeof candidate === 'string' && candidate.length > 0);
			if (url) {
				return url;
			}
			throw new Error('DASH manifest did not include any FLAC URLs.');
		}
		const directUrl = this.parseFlacUrlFromMpd(manifest.manifest);
		if (directUrl) {
			return directUrl;
		}
		throw new Error('Hi-res DASH manifest does not expose a direct FLAC URL.');
	}

	/**
	 * Fetch wrapper with CORS handling
	 */
	private async fetch(url: string, options?: RequestInit): Promise<Response> {
		return fetchWithCORS(url, options);
	}

	/**
	 * Search for tracks
	 */
	async searchTracks(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Track>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?s=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search tracks');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Track>(data, 'tracks');
		return {
			...normalized,
			items: normalized.items.map((track) => this.prepareTrack(track))
		};
	}

	/**
	 * Search for artists
	 */
	async searchArtists(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Artist>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?a=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search artists');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Artist>(data, 'artists');
		return {
			...normalized,
			items: normalized.items.map((artist) => this.prepareArtist(artist))
		};
	}

	/**
	 * Search for albums
	 */
	async searchAlbums(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Album>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?al=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search albums');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Album>(data, 'albums');
		return {
			...normalized,
			items: normalized.items.map((album) => this.prepareAlbum(album))
		};
	}

	/**
	 * Search for playlists
	 */
	async searchPlaylists(query: string, region: RegionOption = 'auto'): Promise<SearchResponse<Playlist>> {
		const response = await this.fetch(
			this.buildRegionalUrl(`/search/?p=${encodeURIComponent(query)}`, region)
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search playlists');
		const data = await response.json();
		return this.normalizeSearchResponse<Playlist>(data, 'playlists');
	}

	/**
	 * Import content from a Tidal URL
	 * Supports track, album, artist, and playlist URLs
	 */
	async importFromUrl(url: string): Promise<{
		type: 'track' | 'album' | 'artist' | 'playlist';
		data: Track | Album | Artist | { playlist: Playlist; tracks: Track[] };
	}> {
		const parsed = parseTidalUrl(url);

		if (parsed.type === 'unknown') {
			throw new Error('Invalid Tidal URL. Please provide a valid track, album, artist, or playlist URL.');
		}

		switch (parsed.type) {
			case 'track': {
				if (!parsed.trackId) {
					throw new Error('Could not extract track ID from URL');
				}
				const lookup = await this.getTrack(parsed.trackId);
				return {
					type: 'track',
					data: this.prepareTrack(lookup.track)
				};
			}

			case 'album': {
				if (!parsed.albumId) {
					throw new Error('Could not extract album ID from URL');
				}
				const { album } = await this.getAlbum(parsed.albumId);
				return {
					type: 'album',
					data: this.prepareAlbum(album)
				};
			}

			case 'artist': {
				if (!parsed.artistId) {
					throw new Error('Could not extract artist ID from URL');
				}
				const artist = await this.getArtist(parsed.artistId);
				return {
					type: 'artist',
					data: this.prepareArtist(artist)
				};
			}

			case 'playlist': {
				if (!parsed.playlistId) {
					throw new Error('Could not extract playlist ID from URL');
				}
				const { playlist, items } = await this.getPlaylist(parsed.playlistId);
				const tracks = items.map((item) => this.prepareTrack(item.item));
				return {
					type: 'playlist',
					data: { playlist, tracks }
				};
			}

			default:
				throw new Error('Unsupported URL type');
		}
	}

	/**
	 * Get track info and stream URL (with retries for quality fallback)
	 */
	async getTrack(id: number, quality: AudioQuality = 'LOSSLESS'): Promise<TrackLookup> {
		const url = `${this.baseUrl}/track/?id=${id}&quality=${quality}`;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(url, { apiVersion: 'v2' });
			this.ensureNotRateLimited(response);
			if (response.ok) {
				const data = await response.json();
				if (this.isV2ApiContainer(data)) {
					return await this.parseTrackLookupV2(id, data, 'v2');
				}
				return this.parseTrackLookup(data);
			}

			let detail: string | undefined;
			let userMessage: string | undefined;
			let subStatus: number | undefined;
			try {
				const errorData = (await response.json()) as {
					detail?: unknown;
					subStatus?: unknown;
					userMessage?: unknown;
				};
				if (typeof errorData?.detail === 'string') {
					detail = errorData.detail;
				}
				if (typeof errorData?.userMessage === 'string') {
					userMessage = errorData.userMessage;
					if (!detail) {
						detail = errorData.userMessage;
					}
				}
				if (typeof errorData?.subStatus === 'number') {
					subStatus = errorData.subStatus;
				}
			} catch {
				// Ignore JSON parse errors
			}

			const isTokenRetry = response.status === 401 && subStatus === 11002;
			const message = detail ?? `Failed to get track (status ${response.status})`;
			lastError = new Error(isTokenRetry ? (userMessage ?? message) : message);
			const shouldRetry =
				isTokenRetry || (detail ? /quality not found/i.test(detail) : response.status >= 500);

			if (attempt === 3 || !shouldRetry) {
				throw lastError;
			}

			await this.delay(200 * attempt);
		}

		throw lastError ?? new Error('Failed to get track');
	}

	async getDashManifest(
		trackId: number,
		quality: AudioQuality = 'HI_RES_LOSSLESS'
	): Promise<DashManifestResult> {
		const { result } = await this.getDashManifestWithMetadata(trackId, quality);
		return result;
	}

	async getDashManifestWithMetadata(
		trackId: number,
		quality: AudioQuality = 'HI_RES_LOSSLESS'
	): Promise<DashManifestWithMetadata> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				const lookup = await this.getTrack(trackId, quality);
				const manifestPayload = lookup.info?.manifest ?? '';
				const contentType = lookup.info?.manifestMimeType ?? null;
				const result = this.buildDashManifestResult(manifestPayload, contentType);
				const trackInfo = {
					sampleRate: lookup.info?.sampleRate ?? null,
					bitDepth: lookup.info?.bitDepth ?? null,
					replayGain: lookup.info?.trackReplayGain ?? null
				};
				return { result, trackInfo };
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}

			if (attempt < 3) {
				await this.delay(200 * attempt);
			}
		}

		throw lastError ?? this.createDashUnavailableError('Unable to load dash manifest for track');
	}

	/**
	 * Get song with stream info
	 */
	async getSong(query: string, quality: AudioQuality = 'LOSSLESS'): Promise<StreamData> {
		const response = await this.fetch(
			`${this.baseUrl}/song/?q=${encodeURIComponent(query)}&quality=${quality}`
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get song');
		return response.json();
	}

	/**
	 * Get album details with track listing
	 */
	async getAlbum(id: number): Promise<{ album: Album; tracks: Track[] }> {
		const response = await this.fetch(`${this.baseUrl}/album/?id=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get album');
		const data = await response.json();
		const entries = Array.isArray(data) ? data : [data];

		let albumEntry: Album | undefined;
		let trackCollection: { items?: unknown[] } | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;

			if (!albumEntry && 'title' in entry && 'id' in entry && 'cover' in entry) {
				albumEntry = this.prepareAlbum(entry as Album);
				continue;
			}

			if (
				!trackCollection &&
				'items' in entry &&
				Array.isArray((entry as { items?: unknown[] }).items)
			) {
				trackCollection = entry as { items?: unknown[] };
			}
		}

		if (!albumEntry) {
			throw new Error('Album not found');
		}

		const tracks: Track[] = [];
		if (trackCollection?.items) {
			for (const rawItem of trackCollection.items) {
				if (!rawItem || typeof rawItem !== 'object') continue;

				let trackCandidate: Track | undefined;
				if ('item' in rawItem && rawItem.item && typeof rawItem.item === 'object') {
					trackCandidate = rawItem.item as Track;
				} else {
					trackCandidate = rawItem as Track;
				}

				if (!trackCandidate) continue;

				const candidateWithAlbum = trackCandidate.album
					? trackCandidate
					: ({ ...trackCandidate, album: albumEntry } as Track);
				tracks.push(this.prepareTrack(candidateWithAlbum));
			}
		}

		return { album: albumEntry, tracks };
	}

	/**
	 * Get playlist details
	 */
	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		const response = await this.fetch(`${this.baseUrl}/playlist/?id=${uuid}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get playlist');
		const data = await response.json();
		return {
			playlist: Array.isArray(data) ? data[0] : data,
			items: Array.isArray(data) && data[1] ? data[1].items : []
		};
	}

	/**
	 * Get artist overview, including discography modules and top tracks
	 */
	async getArtist(id: number): Promise<ArtistDetails> {
		const response = await this.fetch(`${this.baseUrl}/artist/?f=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get artist');
		const data = await response.json();
		const entries = Array.isArray(data) ? data : [data];

		const visited = new Set<object>();
		const albumMap = new Map<number, Album>();
		const trackMap = new Map<number, Track>();
		let artist: Artist | undefined;

		const isTrackLike = (value: unknown): value is Track => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			const albumCandidate = candidate.album as unknown;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.title === 'string' &&
				typeof candidate.duration === 'number' &&
				'trackNumber' in candidate &&
				albumCandidate !== undefined &&
				albumCandidate !== null &&
				typeof albumCandidate === 'object'
			);
		};

		const isAlbumLike = (value: unknown): value is Album => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.title === 'string' &&
				'cover' in candidate
			);
		};

		const isArtistLike = (value: unknown): value is Artist => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.name === 'string' &&
				typeof candidate.type === 'string' &&
				('artistRoles' in candidate || 'artistTypes' in candidate || 'url' in candidate)
			);
		};

		const recordArtist = (candidate: Artist | undefined) => {
			if (!candidate) return;
			const normalized = this.prepareArtist(candidate);
			if (!artist || artist.id === normalized.id) {
				artist = normalized;
			}
		};

		const addAlbum = (candidate: Album | undefined) => {
			if (!candidate || typeof candidate.id !== 'number') return;
			const normalized = this.prepareAlbum({ ...candidate });
			albumMap.set(normalized.id, normalized);
			recordArtist(normalized.artist ?? normalized.artists?.[0]);
		};

		const addTrack = (candidate: Track | undefined) => {
			if (!candidate || typeof candidate.id !== 'number') return;
			const normalized = this.prepareTrack({ ...candidate });
			if (!normalized.album) {
				return;
			}
			addAlbum(normalized.album);
			const knownAlbum = albumMap.get(normalized.album.id);
			if (knownAlbum) {
				normalized.album = knownAlbum;
			}
			trackMap.set(normalized.id, normalized);
			recordArtist(normalized.artist);
		};

		const parseModuleItems = (items: unknown) => {
			if (!Array.isArray(items)) return;
			for (const entry of items) {
				if (!entry || typeof entry !== 'object') {
					continue;
				}

				const candidate = 'item' in entry ? (entry as { item?: unknown }).item : entry;
				if (isAlbumLike(candidate)) {
					addAlbum(candidate as Album);
					const normalizedAlbum = albumMap.get((candidate as Album).id);
					recordArtist(normalizedAlbum?.artist ?? normalizedAlbum?.artists?.[0]);
					continue;
				}
				if (isTrackLike(candidate)) {
					addTrack(candidate as Track);
					continue;
				}

				scanValue(candidate);
			}
		};

		const scanValue = (value: unknown) => {
			if (!value) return;
			if (Array.isArray(value)) {
				const trackCandidates = value.filter(isTrackLike);
				if (trackCandidates.length > 0) {
					for (const track of trackCandidates) {
						addTrack(track);
					}
					return;
				}
				for (const entry of value) {
					scanValue(entry);
				}
				return;
			}

			if (typeof value !== 'object') {
				return;
			}

			const objectRef = value as Record<string, unknown>;
			if (visited.has(objectRef)) {
				return;
			}
			visited.add(objectRef);

			if (isArtistLike(objectRef)) {
				recordArtist(objectRef as Artist);
			}

			if ('modules' in objectRef && Array.isArray(objectRef.modules)) {
				for (const moduleEntry of objectRef.modules) {
					scanValue(moduleEntry);
				}
			}

			if (
				'pagedList' in objectRef &&
				objectRef.pagedList &&
				typeof objectRef.pagedList === 'object'
			) {
				const pagedList = objectRef.pagedList as { items?: unknown };
				parseModuleItems(pagedList.items);
			}

			if ('items' in objectRef && Array.isArray(objectRef.items)) {
				parseModuleItems(objectRef.items);
			}

			if ('rows' in objectRef && Array.isArray(objectRef.rows)) {
				parseModuleItems(objectRef.rows);
			}

			if ('listItems' in objectRef && Array.isArray(objectRef.listItems)) {
				parseModuleItems(objectRef.listItems);
			}

			for (const nested of Object.values(objectRef)) {
				scanValue(nested);
			}
		};

		for (const entry of entries) {
			scanValue(entry);
		}

		if (!artist) {
			const trackPrimaryArtist = Array.from(trackMap.values())
				.map((track) => track.artist ?? track.artists?.[0])
				.find(Boolean);
			const albumPrimaryArtist = Array.from(albumMap.values())
				.map((album) => album.artist ?? album.artists?.[0])
				.find(Boolean);
			recordArtist(trackPrimaryArtist ?? albumPrimaryArtist);
		}

		if (!artist) {
			try {
				const fallbackResponse = await this.fetch(`${this.baseUrl}/artist/?id=${id}`);
				this.ensureNotRateLimited(fallbackResponse);
				if (fallbackResponse.ok) {
					const fallbackData = await fallbackResponse.json();
					const baseArtist = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
					if (baseArtist && typeof baseArtist === 'object') {
						recordArtist(baseArtist as Artist);
					}
				}
			} catch (fallbackError) {
				console.warn('Failed to fetch base artist details:', fallbackError);
			}
		}

		if (!artist) {
			throw new Error('Artist not found');
		}

		const albums = Array.from(albumMap.values()).map((album) => {
			if (!album.artist && artist) {
				return { ...album, artist };
			}
			return album;
		});

		const albumById = new Map(albums.map((album) => [album.id, album] as const));

		const tracks = Array.from(trackMap.values()).map((track) => {
			const enrichedArtist = track.artist ?? artist;
			const album = track.album;
			const enrichedAlbum = album
				? (albumById.get(album.id) ?? (artist && !album.artist ? { ...album, artist } : album))
				: undefined;
			return {
				...track,
				artist: enrichedArtist ?? track.artist,
				album: enrichedAlbum ?? album
			};
		});

		const parseDate = (value?: string): number => {
			if (!value) return Number.NaN;
			const timestamp = Date.parse(value);
			return Number.isFinite(timestamp) ? timestamp : Number.NaN;
		};

		const sortedAlbums = albums.sort((a, b) => {
			const timeA = parseDate(a.releaseDate);
			const timeB = parseDate(b.releaseDate);
			if (Number.isNaN(timeA) && Number.isNaN(timeB)) {
				return (b.popularity ?? 0) - (a.popularity ?? 0);
			}
			if (Number.isNaN(timeA)) return 1;
			if (Number.isNaN(timeB)) return -1;
			return timeB - timeA;
		});

		const sortedTracks = tracks
			.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
			.slice(0, 100);

		return {
			...artist,
			albums: sortedAlbums,
			tracks: sortedTracks
		};
	}

	/**
	 * Get cover image
	 */
	async getCover(id?: number, query?: string): Promise<CoverImage[]> {
		let url = `${this.baseUrl}/cover/?`;
		if (id) url += `id=${id}`;
		if (query) url += `q=${encodeURIComponent(query)}`;
		const response = await this.fetch(url);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get cover');
		return response.json();
	}

	/**
	 * Get lyrics for a track
	 */
	async getLyrics(id: number): Promise<Lyrics> {
		const response = await this.fetch(`${this.baseUrl}/lyrics/?id=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get lyrics');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
	}

	/**
	 * Get stream data including URL and replay gain
	 */
	async getStreamData(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS'
	): Promise<{ url: string; replayGain: number | null }> {
		let replayGain: number | null = null;

		if (this.isHiResQuality(quality)) {
			try {
				// Try to fetch metadata for replay gain, but don't fail if it fails
				try {
					const lookup = await this.getTrack(trackId, quality);
					replayGain = lookup.info.trackReplayGain ?? null;
				} catch {
					// Ignore metadata fetch failure for HiRes
				}

				const url = await this.resolveHiResStreamFromDash(trackId);
				return { url, replayGain };
			} catch (error) {
				console.warn('Failed to resolve hi-res stream via DASH manifest', error);
				quality = 'LOSSLESS';
			}
		}

		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				const lookup = await this.getTrack(trackId, quality);
				replayGain = lookup.info.trackReplayGain ?? null;

				if (lookup.originalTrackUrl) {
					return { url: lookup.originalTrackUrl, replayGain };
				}

				const manifestUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
				if (manifestUrl) {
					return { url: manifestUrl, replayGain };
				}

				lastError = new Error('Unable to resolve stream URL for track');
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}

			if (attempt < 3) {
				await this.delay(200 * attempt);
			}
		}

		throw lastError ?? new Error('Unable to resolve stream URL for track');
	}

	/**
	 * Get stream URL for a track
	 */
	async getStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		const data = await this.getStreamData(trackId, quality);
		return data.url;
	}

	/**
	 * Attempt to embed metadata into a downloaded track using FFmpeg WASM
	 */
	private async embedMetadataIntoBlob(
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType: string | null,
		options: DownloadTrackOptions | undefined,
		quality: AudioQuality,
		convertToMp3: boolean
	): Promise<Blob | null> {
		const job = this.metadataQueue.then(() =>
			this.runMetadataEmbedding(
				blob,
				lookup,
				filename,
				contentType ?? undefined,
				options,
				quality,
				convertToMp3
			)
		);
		this.metadataQueue = job.then(
			() => undefined,
			() => undefined
		);

		try {
			return await job;
		} catch (error) {
			console.warn('Metadata embedding failed', error);
			return null;
		}
	}

	private inferExtensionFromFilename(filename: string): string | null {
		const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(filename);
		return match ? match[1]!.toLowerCase() : null;
	}

	private inferExtensionFromMime(mime?: string | null): string | null {
		if (!mime) return null;
		const normalized = mime.split(';')[0]?.trim().toLowerCase();
		switch (normalized) {
			case 'audio/flac':
				return 'flac';
			case 'audio/x-flac':
				return 'flac';
			case 'audio/mpeg':
				return 'mp3';
			case 'audio/mp3':
				return 'mp3';
			case 'audio/mp4':
			case 'audio/aac':
			case 'audio/x-m4a':
				return 'm4a';
			case 'audio/wav':
			case 'audio/x-wav':
				return 'wav';
			case 'audio/ogg':
				return 'ogg';
			default:
				return null;
		}
	}

	private inferMimeFromExtension(
		ext: string | null | undefined,
		fallbackType?: string
	): string | undefined {
		switch (ext) {
			case 'flac':
				return 'audio/flac';
			case 'mp3':
				return 'audio/mpeg';
			case 'm4a':
			case 'aac':
				return 'audio/mp4';
			case 'wav':
				return 'audio/wav';
			case 'ogg':
				return 'audio/ogg';
			default:
				return fallbackType;
		}
	}

	private validateImageData(data: Uint8Array): boolean {
		// Check if data is long enough to contain magic bytes
		if (!data || data.length < 4) {
			return false;
		}

		// Check for JPEG magic bytes (FF D8 FF)
		if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
			return true;
		}

		// Check for PNG magic bytes (89 50 4E 47)
		if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
			return true;
		}

		// Check for WebP magic bytes (52 49 46 46 ... 57 45 42 50)
		if (data.length >= 12 &&
		    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
		    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
			return true;
		}

		return false;
	}

	private detectImageFormat(data: Uint8Array): { extension: string; mimeType: string } | null {
		if (!data || data.length < 4) {
			return null;
		}

		// Check for JPEG magic bytes (FF D8 FF)
		if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
			return { extension: 'jpg', mimeType: 'image/jpeg' };
		}

		// Check for PNG magic bytes (89 50 4E 47)
		if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
			return { extension: 'png', mimeType: 'image/png' };
		}

		// Check for WebP magic bytes (52 49 46 46 ... 57 45 42 50)
		if (data.length >= 12 &&
		    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
		    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
			return { extension: 'webp', mimeType: 'image/webp' };
		}

		return null;
	}

	private buildMetadataEntries(lookup: TrackLookup): Array<[string, string]> {
		const entries: Array<[string, string]> = [];
		const { track } = lookup;
		const album = track.album;
		const mainArtist = formatArtistsForMetadata(track.artists);
		const albumArtist = album?.artist?.name ??
			(album?.artists && album.artists.length > 0 ? album.artists[0]?.name : undefined) ??
			track.artists?.[0]?.name;

		if (track.title) entries.push(['title', track.title]);
		if (mainArtist) entries.push(['artist', mainArtist]);
		if (albumArtist) entries.push(['album_artist', albumArtist]);
		if (album?.title) entries.push(['album', album.title]);

		const trackNumber = Number(track.trackNumber);
		const totalTracks = Number(album?.numberOfTracks);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			const value =
				Number.isFinite(totalTracks) && totalTracks > 0
					? `${trackNumber}/${totalTracks}`
					: `${trackNumber}`;
			entries.push(['track', value]);
		}

		const discNumber = Number(track.volumeNumber);
		const totalDiscs = Number(album?.numberOfVolumes);
		if (Number.isFinite(discNumber) && discNumber > 0) {
			const value =
				Number.isFinite(totalDiscs) && totalDiscs > 0
					? `${discNumber}/${totalDiscs}`
					: `${discNumber}`;
			entries.push(['disc', value]);
		}

		const releaseDate = album?.releaseDate ?? track.streamStartDate;
		if (releaseDate) {
			const yearMatch = /^(\d{4})/.exec(releaseDate);
			if (yearMatch?.[1]) {
				entries.push(['date', yearMatch[1]]);
				entries.push(['year', yearMatch[1]]);
			}
		}

		// API does not include genre
		/*
		const tags = track.mediaMetadata?.tags ?? album?.mediaMetadata?.tags;
		if (tags && tags.length > 0) {
			entries.push(['genre', tags.join('; ')]);
		}
		*/

		if (track.isrc) {
			entries.push(['ISRC', track.isrc]);
		}

		if (album?.copyright) {
			entries.push(['copyright', album.copyright]);
		}

		// ReplayGain
		if (lookup.info) {
			const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude } = lookup.info;
			
			if (trackReplayGain !== undefined && trackReplayGain !== null) {
				entries.push(['REPLAYGAIN_TRACK_GAIN', `${trackReplayGain} dB`]);
			}
			if (trackPeakAmplitude !== undefined && trackPeakAmplitude !== null) {
				entries.push(['REPLAYGAIN_TRACK_PEAK', `${trackPeakAmplitude}`]);
			}
			if (albumReplayGain !== undefined && albumReplayGain !== null) {
				entries.push(['REPLAYGAIN_ALBUM_GAIN', `${albumReplayGain} dB`]);
			}
			if (albumPeakAmplitude !== undefined && albumPeakAmplitude !== null) {
				entries.push(['REPLAYGAIN_ALBUM_PEAK', `${albumPeakAmplitude}`]);
			}
		} else if (track.replayGain) {
			entries.push(['REPLAYGAIN_TRACK_GAIN', `${track.replayGain} dB`]);
			if (track.peak) {
				entries.push(['REPLAYGAIN_TRACK_PEAK', `${track.peak}`]);
			}
		}

		entries.push(['comment', 'Downloaded from music.binimum.org/tidal.squid.wtf']);

		return entries;
	}

	private async runMetadataEmbedding(
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType: string | undefined,
		options: DownloadTrackOptions | undefined,
		quality: AudioQuality,
		convertToMp3: boolean
	): Promise<Blob | null> {
		if (typeof window === 'undefined') {
			return null;
		}

		const extensionFromMime = this.inferExtensionFromMime(contentType);
		const extensionFromFilename = this.inferExtensionFromFilename(filename);
		const extension = extensionFromMime ?? extensionFromFilename;

		if (!extension) {
			return null;
		}

		const supportedExtensions = new Set(['flac', 'mp3', 'm4a', 'aac', 'wav', 'ogg']);
		if (!supportedExtensions.has(extension)) {
			return null;
		}

		const convertibleExtensions = new Set(['m4a', 'aac', 'mp4']);
		const shouldConvertToMp3 = convertToMp3 && convertibleExtensions.has(extension);
		const outputExtension = shouldConvertToMp3 ? 'mp3' : extension;
		const targetBitrate = quality === 'LOW' ? '96k' : '320k';

		let ffmpegModule: typeof import('./ffmpegClient') | null = null;
		try {
			ffmpegModule = await import('./ffmpegClient');
		} catch (error) {
			console.warn('Unable to load FFmpeg client module', error);
			options?.onFfmpegError?.(error);
			return null;
		}

		if (!ffmpegModule.isFFmpegSupported()) {
			return null;
		}

		if (options?.onFfmpegCountdown) {
			try {
				const estimatedBytes = await ffmpegModule.estimateFfmpegDownloadSize?.();
				options.onFfmpegCountdown({
					totalBytes: estimatedBytes,
					autoTriggered: options.ffmpegAutoTriggered ?? false
				});
			} catch (estimateError) {
				console.debug('Failed to estimate FFmpeg size', estimateError);
				options.onFfmpegCountdown({
					totalBytes: undefined,
					autoTriggered: options.ffmpegAutoTriggered ?? false
				});
			}
		}

		options?.onFfmpegStart?.();

		let ffmpeg: Awaited<ReturnType<typeof ffmpegModule.getFFmpeg>>;
		let progressHandler: ((data: { progress: number }) => void) | null = null;
		
		try {
			const loadOptions: Parameters<typeof ffmpegModule.getFFmpeg>[0] = {
				signal: options?.signal,
				onProgress: ({
					receivedBytes,
					totalBytes
				}: {
					receivedBytes: number;
					totalBytes?: number;
				}) => {
					if (totalBytes && totalBytes > 0) {
						options?.onFfmpegProgress?.(Math.max(0, Math.min(1, receivedBytes / totalBytes)));
					} else if (receivedBytes > 0) {
						options?.onFfmpegProgress?.(0);
					}
				}
			};
			ffmpeg = await ffmpegModule.getFFmpeg(loadOptions);
			
			// Set up progress tracking for this specific job
			progressHandler = ({ progress }: { progress: number }) => {
				if (options?.onProgress && progress >= 0) {
					options.onProgress({ stage: 'embedding', progress: Math.min(1, progress) });
				}
			};
			ffmpeg.on('progress', progressHandler);
			
			options?.onFfmpegProgress?.(1);
			options?.onFfmpegComplete?.();
		} catch (loadError) {
			options?.onFfmpegError?.(loadError);
			throw loadError;
		}
		const uniqueSuffix =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
		const inputName = `source-${uniqueSuffix}.${extension}`;
		const outputName = `output-${uniqueSuffix}.${outputExtension}`;

		let coverWritten = false;
		let coverExtension = 'jpg';

		try {
			if (options?.onProgress) {
				options.onProgress({ stage: 'embedding', progress: 0 });
			}
			
			// Convert blob to Uint8Array to ensure proper memory handling
			const arrayBuffer = await blob.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);
			
			await ffmpeg.writeFile(inputName, uint8Array);

			const artworkId = lookup.track.album?.cover;
			
			if (artworkId) {
				// Try multiple sizes as fallback
				const coverSizes: Array<'1280' | '640' | '320'> = ['1280', '640', '320'];
				let coverFetchSuccess = false;
				
				for (const size of coverSizes) {
					if (coverFetchSuccess) break;
					
					const coverUrl = this.getCoverUrl(artworkId, size);
					
					// Try two fetch strategies: with headers, then without
					const fetchStrategies = [
						{
							name: 'with-headers',
							options: {
								method: 'GET' as const,
								headers: {
									'Accept': 'image/jpeg,image/jpg,image/png,image/*',
									'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
								},
								signal: AbortSignal.timeout(10000)
							}
						},
						{
							name: 'simple',
							options: {
								method: 'GET' as const,
								signal: AbortSignal.timeout(10000)
							}
						}
					];
					
					for (const strategy of fetchStrategies) {
						if (coverFetchSuccess) break;
					
					try {
						const coverResponse = await fetch(coverUrl, strategy.options);
						
						if (!coverResponse.ok) {
							continue; // Try next size
						}
						
						const contentType = coverResponse.headers.get('Content-Type');
						const contentLength = coverResponse.headers.get('Content-Length');
						
						// Check if Content-Length indicates empty response
						if (contentLength && parseInt(contentLength, 10) === 0) {
							continue; // Try next size
						}
						
						if (contentType && !contentType.startsWith('image/')) {
							continue; // Try next size
						}
						
						// Try arrayBuffer directly instead of blob first (more reliable)
						let coverArrayBuffer: ArrayBuffer;
						
						try {
							coverArrayBuffer = await coverResponse.arrayBuffer();
						} catch {
							continue; // Try next size
						}
						
						if (!coverArrayBuffer || coverArrayBuffer.byteLength === 0) {
							continue; // Try next size
						}
						
						const coverUint8Array = new Uint8Array(coverArrayBuffer);
						
						// Detect image format from magic bytes
						const imageFormat = this.detectImageFormat(coverUint8Array);
						if (!imageFormat) {
							continue; // Try next size
						}
						
						coverExtension = imageFormat.extension;
						const finalCoverName = `cover-${uniqueSuffix}.${coverExtension}`;
						
						await ffmpeg.writeFile(finalCoverName, coverUint8Array);
						coverWritten = true;
						coverFetchSuccess = true;
						break; // Success, exit strategy loop
						
					} catch {
						// Continue to next strategy
					}
					} // End strategy loop
				} // End size loop
			}

			const args: string[] = ['-i', inputName];
			if (coverWritten) {
				const finalCoverName = `cover-${uniqueSuffix}.${coverExtension}`;
				args.push('-i', finalCoverName);
			}
			
			// Map streams FIRST (matching working command pattern)
			// Working command: -map 0:a -map 1 -codec copy
			if (coverWritten) {
				args.push('-map', '0:a');  // Map audio stream from first input
				args.push('-map', '1');    // Map entire second input (cover image)
			} else {
				args.push('-map', '0:a');
			}
			
			// Codec settings
			if (shouldConvertToMp3) {
				args.push('-codec:a', 'libmp3lame');
				args.push('-b:a', targetBitrate);
			} else {
				args.push('-codec', 'copy');
			}
			
			// Track metadata (title, artist, album, etc.)
			for (const [key, value] of this.buildMetadataEntries(lookup)) {
				args.push('-metadata', `${key}=${value}`);
			}
			
			// Cover-specific metadata and disposition (matching working command)
			if (coverWritten) {
				args.push('-metadata:s:v', 'title=Album cover');
				args.push('-metadata:s:v', 'comment=Cover (front)');
				args.push('-disposition:v', 'attached_pic');
			}
			
			// MP3-specific settings
			if (shouldConvertToMp3) {
				args.push('-id3v2_version', '3');
				args.push('-write_xing', '0');
			}

			args.push(outputName);
			
			// Execute FFmpeg with timeout protection (3 minutes for large files)
			const timeoutMs = 180000; // 3 minutes
			const execPromise = ffmpeg.exec(args);
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new Error(`FFmpeg execution timeout - processing took longer than 3 minutes. Try using "Download covers separately" option instead.`));
				}, timeoutMs);
			});
			
			try {
				await Promise.race([execPromise, timeoutPromise]);
			} catch (execError) {
				// Check if it's a timeout
				const errorMessage = execError instanceof Error ? execError.message : String(execError);
				if (errorMessage.includes('timeout')) {
					throw new Error('FFmpeg timeout: Processing took too long. Enable "Download covers separately" option for FLAC files.');
				}
				
				// Check if it's a memory error
				if (errorMessage.includes('memory access out of bounds') || 
				    errorMessage.includes('RuntimeError') ||
				    errorMessage.includes('out of memory')) {
					throw new Error('FFmpeg memory error: File may be too large for browser processing. Try a smaller file or download without metadata embedding.');
				}
				
				throw execError;
			}
			
			const outputData = await ffmpeg.readFile(outputName);
			if (options?.onProgress) {
				options.onProgress({ stage: 'embedding', progress: 1 });
			}
			let outputArray: Uint8Array;
			if (outputData instanceof Uint8Array) {
				outputArray = outputData;
			} else if (typeof outputData === 'string') {
				outputArray = new TextEncoder().encode(outputData);
			} else {
				outputArray = new Uint8Array((outputData as unknown as ArrayBuffer) ?? new ArrayBuffer(0));
			}
			const blobArray = new Uint8Array(outputArray);
			const mimeType = this.inferMimeFromExtension(
				outputExtension,
				contentType ?? (blob.type && blob.type.length > 0 ? blob.type : undefined)
			);
			const resultBlob = new Blob([blobArray], { type: mimeType });
			return resultBlob;
		} catch (error) {
			// Check if it's a memory error and provide helpful message
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('memory access out of bounds') || 
			    errorMessage.includes('RuntimeError') ||
			    errorMessage.includes('out of memory') ||
			    errorMessage.includes('memory error')) {
				options?.onFfmpegError?.(new Error('Memory error: File processed without metadata due to browser limitations'));
			} else {
				options?.onFfmpegError?.(error);
			}
			
			// Return null to fallback to original blob (handled by caller)
			return null;
		} finally {
			// Remove progress handler
			if (progressHandler && ffmpeg) {
				ffmpeg.off('progress', progressHandler);
			}
			
			// Clean up temporary files
			if (ffmpeg) {
				try {
					await ffmpeg.deleteFile(inputName);
				} catch (cleanupErr) {
					console.debug('Failed to delete FFmpeg input file', cleanupErr);
				}
				try {
					await ffmpeg.deleteFile(outputName);
				} catch (cleanupErr) {
					console.debug('Failed to delete FFmpeg output file', cleanupErr);
				}
				if (coverWritten) {
					try {
						const finalCoverName = `cover-${uniqueSuffix}.${coverExtension}`;
						await ffmpeg.deleteFile(finalCoverName);
					} catch (cleanupErr) {
						console.debug('Failed to delete FFmpeg cover file', cleanupErr);
					}
				}
			}
		}
	}

	private async resolveTrackLookups(
		trackId: number,
		quality: AudioQuality
	): Promise<{
		manifestLookup: TrackLookup;
		metadataLookup: TrackLookup;
		manifestQuality: AudioQuality;
	}> {
		const manifestLookup = await this.getTrack(trackId, quality);
		const metadataLookup = manifestLookup;
		return { manifestLookup, metadataLookup, manifestQuality: quality };
	}

	async getPreferredTrackMetadata(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS'
	): Promise<TrackLookup> {
		const { metadataLookup } = await this.resolveTrackLookups(trackId, quality);
		return metadataLookup;
	}

	async fetchTrackBlob(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS',
		filename: string,
		options?: DownloadTrackOptions
	): Promise<{ blob: Blob; mimeType?: string }> {
		try {
			const {
				manifestLookup,
				metadataLookup: initialMetadataLookup,
				manifestQuality
			} = await this.resolveTrackLookups(trackId, quality);
			let metadataLookup = initialMetadataLookup;
			let response: Response | null = null;
			let streamUrl: string | null = null;
			let downloadBlob: Blob | null = null;
			let contentType: string | null = null;
			let receivedBytes = 0;
			let totalBytes: number | undefined;

			streamUrl = manifestLookup.originalTrackUrl || null;
			if (streamUrl) {
				response = await fetch(streamUrl, { signal: options?.signal });
				if (response.status === 429) {
					throw new Error(RATE_LIMIT_ERROR_MESSAGE);
				}
				if (!response.ok) {
					console.warn('OriginalTrackUrl download failed, falling back to manifest', {
						status: response.status
					});
					response = null;
				}
			}

			if (!response) {
				let manifestSource = manifestLookup;
				const decodedManifest = this.decodeBase64Manifest(manifestSource.info.manifest);
				
				// For segmented DASH manifests, go directly to segment download
				if (this.isSegmentedDashManifest(decodedManifest)) {
					try {
						const mpdResult = await this.downloadFlacFromMpd(decodedManifest, options);
						if (mpdResult) {
							downloadBlob = mpdResult.blob;
							contentType = mpdResult.mimeType;
							receivedBytes = downloadBlob.size;
							totalBytes = downloadBlob.size;
							metadataLookup = manifestSource;
						}
					} catch (mpdError) {
						console.warn('Failed to download FLAC from MPD manifest', mpdError);
					}

					if (!downloadBlob) {
						throw new Error('Could not download segmented DASH content');
					}
				} else {
					// Try to extract a direct stream URL
					let fallbackUrl = this.extractStreamUrlFromManifest(manifestSource.info.manifest);
					if (!fallbackUrl && manifestQuality !== 'LOSSLESS') {
						try {
							const losslessLookup = await this.getTrack(trackId, 'LOSSLESS');
							const candidateUrl = this.extractStreamUrlFromManifest(losslessLookup.info.manifest);
							if (candidateUrl) {
								fallbackUrl = candidateUrl;
								manifestSource = losslessLookup;
							}
						} catch (manifestError) {
							console.warn('Failed to fetch lossless manifest for download fallback', manifestError);
						}
					}

					if (fallbackUrl) {
						streamUrl = fallbackUrl;
						response = await fetch(fallbackUrl, { signal: options?.signal });
						if (response.status === 429) {
							throw new Error(RATE_LIMIT_ERROR_MESSAGE);
						}
						if (!response.ok) {
							throw new Error('Failed to fetch audio stream');
						}
						metadataLookup = manifestSource;
					} else {
						throw new Error('Could not extract stream URL from manifest');
					}
				}
			}

			if (response) {
				const totalHeader = Number(response.headers.get('Content-Length') ?? '0');
				totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;

				if (!response.body) {
					downloadBlob = await response.blob();
					receivedBytes = downloadBlob.size;
					if (!totalBytes && receivedBytes > 0) {
						options?.onProgress?.({
							stage: 'downloading',
							receivedBytes,
							totalBytes: receivedBytes
						});
					}
				} else {
					const reader = response.body.getReader();
					const chunks: Uint8Array[] = [];
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						if (value) {
							receivedBytes += value.byteLength;
							chunks.push(value);
							options?.onProgress?.({
								stage: 'downloading',
								receivedBytes,
								totalBytes
							});
						}
					}
					downloadBlob = new Blob(chunks as BlobPart[], {
						type: response.headers.get('Content-Type') ?? 'application/octet-stream'
					});
					if (receivedBytes === 0) {
						receivedBytes = downloadBlob.size;
					}
				}

				contentType = response.headers.get('Content-Type');
			}

			options?.onProgress?.({
				stage: 'downloading',
				receivedBytes,
				totalBytes: totalBytes ?? downloadBlob?.size
			});

			if (!downloadBlob) {
				throw new Error('Download failed to produce audio payload');
			}

			const shouldConvertToMp3 =
				options?.convertAacToMp3 === true && (quality === 'HIGH' || quality === 'LOW');
			const processedBlob = await this.embedMetadataIntoBlob(
				downloadBlob,
				metadataLookup,
				filename,
				contentType,
				options,
				quality,
				shouldConvertToMp3
			);
			const finalBlob = processedBlob ?? downloadBlob;
			return { blob: finalBlob, mimeType: contentType ?? undefined };
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
			if (error instanceof Error && error.message === RATE_LIMIT_ERROR_MESSAGE) {
				throw error;
			}
			throw new Error(
				'Download failed. The stream URL may require a proxy. Please try streaming instead.'
			);
		}
	}

	async getTrackStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		if (this.isHiResQuality(quality)) {
			quality = 'LOSSLESS';
		}

		const lookup = await this.getTrack(trackId, quality);
		if (lookup.originalTrackUrl) {
			return lookup.originalTrackUrl;
		}
		const fallback = this.extractStreamUrlFromManifest(lookup.info.manifest);
		if (!fallback) {
			throw new Error('Could not resolve stream URL for track');
		}
		return fallback;
	}

	/**
	 * Download a track
	 * Fetches the audio stream and triggers a download
	 */
	async downloadTrack(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS',
		filename: string,
		options?: DownloadTrackOptions
	): Promise<void> {
		try {
			const { blob } = await this.fetchTrackBlob(trackId, quality, filename, options);
			const url = URL.createObjectURL(blob);

			// Trigger download
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			// Download cover separately if enabled
			if (options?.downloadCoverSeperately) {
				try {
					const metadata = await this.getPreferredTrackMetadata(trackId, quality);
					const coverId = metadata.track.album?.cover;
					if (coverId) {
						console.log('[Cover Download] Fetching cover for separate download...');
						
						// Try multiple sizes as fallback
						const coverSizes: Array<'1280' | '640' | '320'> = ['1280', '640', '320'];
						let coverDownloadSuccess = false;
						
						for (const size of coverSizes) {
							if (coverDownloadSuccess) break;
							
							const coverUrl = this.getCoverUrl(coverId, size);
							console.log(`[Cover Download] Attempting size ${size}:`, coverUrl);
							
							// Try two fetch strategies: with headers, then without
							const fetchStrategies = [
								{
									name: 'with-headers',
									options: {
										method: 'GET' as const,
										headers: {
											'Accept': 'image/jpeg,image/jpg,image/png,image/*',
											'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
										},
										signal: AbortSignal.timeout(10000)
									}
								},
								{
									name: 'simple',
									options: {
										method: 'GET' as const,
										signal: AbortSignal.timeout(10000)
									}
								}
							];
							
							for (const strategy of fetchStrategies) {
								if (coverDownloadSuccess) break;
								
								console.log(`[Cover Download] Trying strategy: ${strategy.name}`);
							
							try {
								const coverResponse = await fetch(coverUrl, strategy.options);
								
								console.log(`[Cover Download] Response status: ${coverResponse.status}, Content-Length: ${coverResponse.headers.get('Content-Length')}`);
								
								if (!coverResponse.ok) {
									console.warn(`[Cover Download] Failed with status ${coverResponse.status} for size ${size}`);
									continue;
								}
								
								const contentType = coverResponse.headers.get('Content-Type');
								const contentLength = coverResponse.headers.get('Content-Length');
								
								if (contentLength && parseInt(contentLength, 10) === 0) {
									console.warn(`[Cover Download] Content-Length is 0 for size ${size}`);
									continue;
								}
								
								if (contentType && !contentType.startsWith('image/')) {
									console.warn(`[Cover Download] Invalid content type: ${contentType}`);
									continue;
								}
								
								// Use arrayBuffer directly for more reliable data retrieval
								const arrayBuffer = await coverResponse.arrayBuffer();
								
								if (!arrayBuffer || arrayBuffer.byteLength === 0) {
									console.warn(`[Cover Download] Empty array buffer for size ${size}`);
									continue;
								}
								
								const uint8Array = new Uint8Array(arrayBuffer);
								console.log(`[Cover Download] Received ${uint8Array.length} bytes`);
								console.log(`[Cover Download] First 16 bytes:`, Array.from(uint8Array.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
								
								// Validate image data
								if (!this.validateImageData(uint8Array)) {
									console.warn(`[Cover Download] Invalid image data for size ${size}`);
									continue;
								}
								
								// Detect image format
								const imageFormat = this.detectImageFormat(uint8Array);
								if (!imageFormat) {
									console.warn(`[Cover Download] Unknown image format for size ${size}`);
									continue;
								}
								
								// Create blob with correct MIME type
								const coverBlob = new Blob([uint8Array], { type: imageFormat.mimeType });
								
								const coverObjectUrl = URL.createObjectURL(coverBlob);
								const coverLink = document.createElement('a');
								coverLink.href = coverObjectUrl;
								coverLink.download = `cover.${imageFormat.extension}`;
								document.body.appendChild(coverLink);
								coverLink.click();
								document.body.removeChild(coverLink);
								URL.revokeObjectURL(coverObjectUrl);
								
								coverDownloadSuccess = true;
								console.log(`[Cover Download] Successfully downloaded (${size}x${size}, format: ${imageFormat.extension}, strategy: ${strategy.name})`);
								break;
							} catch (sizeError) {
								console.warn(`[Cover Download] Failed at size ${size} with strategy ${strategy.name}:`, sizeError);
							}
							} // End strategy loop
						} // End size loop
						
						if (!coverDownloadSuccess) {
							console.warn('[Cover Download] All attempts failed');
						}
					}
				} catch (coverError) {
					console.warn('Failed to download cover separately:', coverError);
				}
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw error;
			}
			console.error('Download failed:', error);
			if (error instanceof Error && error.message === RATE_LIMIT_ERROR_MESSAGE) {
				throw error;
			}
			throw new Error(
				'Download failed. The stream URL may require a proxy. Please try streaming instead.'
			);
		}
	}

	/**
	 * Format duration from seconds to MM:SS
	 */
	formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	/**
	 * Get cover URL
	 */
	getCoverUrl(coverId: string, size: '1280' | '640' | '320' | '160' | '80' = '640'): string {
		return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
	}

	/**
	 * Get video cover URL
	 */
	getVideoCoverUrl(videoCoverId: string, size: '1280' | '640' | '320' | '160' | '80' = '640'): string {
		return `https://resources.tidal.com/videos/${videoCoverId.replace(/-/g, '/')}/${size}x${size}.mp4`;
	}

	/**
	 * Get artist picture URL
	 */
	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		return `https://resources.tidal.com/images/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
	}
}

export const losslessAPI = new LosslessAPI();
