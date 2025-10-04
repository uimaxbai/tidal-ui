// API service for HIFI Tidal API
import { API_CONFIG, fetchWithCORS } from './config';
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
	TrackLookup
} from './types';

const API_BASE = API_CONFIG.baseUrl;
const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';

class TidalAPI {
	public baseUrl: string;

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
	}

	private normalizeSearchResponse<T>(
		data: unknown,
		key: 'tracks' | 'albums' | 'artists' | 'playlists'
	): SearchResponse<T> {
		const section = this.findSearchSection<T>(data, key, new Set());
		return this.buildSearchResponse<T>(section);
	}

	private buildSearchResponse<T>(section: Partial<SearchResponse<T>> | undefined): SearchResponse<T> {
		const items = section?.items;
		const list = Array.isArray(items) ? (items as T[]) : [];
		const limit = typeof section?.limit === 'number' ? section.limit : list.length;
		const offset = typeof section?.offset === 'number' ? section.offset : 0;
		const total =
			typeof section?.totalNumberOfItems === 'number'
				? section.totalNumberOfItems
				: list.length;

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
		if (!track.artist && Array.isArray(track.artists) && track.artists.length > 0) {
			return { ...track, artist: track.artists[0]! };
		}
		return track;
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
			const decoded = atob(manifest);
			try {
				const parsed = JSON.parse(decoded) as { urls?: string[] };
				if (parsed && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
					return parsed.urls[0] ?? null;
				}
			} catch (jsonError) {
				// Ignore JSON parse failure and fall back to regex search
				console.debug('Manifest JSON parse failed, falling back to pattern match', jsonError);
			}

			const match = decoded.match(/https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/);
			return match ? match[0] : null;
		} catch (error) {
			console.error('Failed to decode manifest:', error);
			return null;
		}
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
	async searchTracks(query: string): Promise<SearchResponse<Track>> {
		const response = await this.fetch(`${this.baseUrl}/search/?s=${encodeURIComponent(query)}`);
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
	async searchArtists(query: string): Promise<SearchResponse<Artist>> {
		const response = await this.fetch(`${this.baseUrl}/search/?a=${encodeURIComponent(query)}`);
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
	async searchAlbums(query: string): Promise<SearchResponse<Album>> {
		const response = await this.fetch(`${this.baseUrl}/search/?al=${encodeURIComponent(query)}`);
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
	async searchPlaylists(query: string): Promise<SearchResponse<Playlist>> {
		const response = await this.fetch(`${this.baseUrl}/search/?p=${encodeURIComponent(query)}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search playlists');
		const data = await response.json();
		return this.normalizeSearchResponse<Playlist>(data, 'playlists');
	}

	/**
	 * Get track info and stream URL (with retries for quality fallback)
	 */
	async getTrack(id: number, quality: AudioQuality = 'LOSSLESS'): Promise<TrackLookup> {
		const url = `${this.baseUrl}/track/?id=${id}&quality=${quality}`;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(url);
			this.ensureNotRateLimited(response);
			if (response.ok) {
				const data = await response.json();
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
			lastError = new Error(isTokenRetry ? userMessage ?? message : message);
			const shouldRetry =
				isTokenRetry || (detail ? /quality not found/i.test(detail) : response.status >= 500);

			if (attempt === 3 || !shouldRetry) {
				throw lastError;
			}

			await this.delay(200 * attempt);
		}

		throw lastError ?? new Error('Failed to get track');
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
	 * Get album details
	 */
	async getAlbum(id: number): Promise<Album> {
		const response = await this.fetch(`${this.baseUrl}/album/?id=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get album');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
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
	 * Get artist details
	 */
	async getArtist(id: number, full: boolean = false): Promise<Artist> {
		const url = full ? `${this.baseUrl}/artist/?f=${id}` : `${this.baseUrl}/artist/?id=${id}`;
		const response = await this.fetch(url);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get artist');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
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
	 * Get stream URL for a track
	 */
	async getStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				const lookup = await this.getTrack(trackId, quality);
				if (lookup.originalTrackUrl) {
					return lookup.originalTrackUrl;
				}

				const manifestUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
				if (manifestUrl) {
					return manifestUrl;
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
	 * Download a track
	 * Fetches the audio stream and triggers a download
	 */
	async downloadTrack(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS',
		filename: string
	): Promise<void> {
		try {
			const lookup = await this.getTrack(trackId, quality);
			let streamUrl = lookup.originalTrackUrl || null;
			let response: Response | null = null;

			if (streamUrl) {
				response = await fetch(streamUrl);
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
				const fallbackUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
				if (!fallbackUrl) {
					throw new Error('Could not extract stream URL from manifest');
				}

				streamUrl = fallbackUrl;
				response = await fetch(streamUrl);
				if (response.status === 429) {
					throw new Error(RATE_LIMIT_ERROR_MESSAGE);
				}
				if (!response.ok) {
					throw new Error('Failed to fetch audio stream');
				}
			}

			const blob = await response.blob();
			const url = URL.createObjectURL(blob);

			// Trigger download
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error) {
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
	getCoverUrl(coverId: string, size: '1280' | '640' | '80' = '640'): string {
		return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
	}

	/**
	 * Get artist picture URL
	 */
	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		return `https://resources.tidal.com/images/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
	}
}

export const tidalAPI = new TidalAPI();
