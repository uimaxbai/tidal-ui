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

class TidalAPI {
	public baseUrl: string;

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
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
		if (!response.ok) throw new Error('Failed to search tracks');
		return response.json();
	}

	/**
	 * Search for artists
	 */
	async searchArtists(query: string): Promise<SearchResponse<Artist>> {
		const response = await this.fetch(`${this.baseUrl}/search/?a=${encodeURIComponent(query)}`);
		if (!response.ok) throw new Error('Failed to search artists');
		return response.json();
	}

	/**
	 * Search for albums
	 */
	async searchAlbums(query: string): Promise<SearchResponse<Album>> {
		const response = await this.fetch(`${this.baseUrl}/search/?al=${encodeURIComponent(query)}`);
		if (!response.ok) throw new Error('Failed to search albums');
		return response.json();
	}

	/**
	 * Search for playlists
	 */
	async searchPlaylists(query: string): Promise<SearchResponse<Playlist>> {
		const response = await this.fetch(`${this.baseUrl}/search/?p=${encodeURIComponent(query)}`);
		if (!response.ok) throw new Error('Failed to search playlists');
		return response.json();
	}

	/**
	 * Get track info and stream URL (with retries for quality fallback)
	 */
	async getTrack(id: number, quality: AudioQuality = 'LOSSLESS'): Promise<TrackLookup> {
		const url = `${this.baseUrl}/track/?id=${id}&quality=${quality}`;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(url);
			if (response.ok) {
				const data = await response.json();
				return this.parseTrackLookup(data);
			}

			let detail: string | undefined;
			try {
				const errorData = (await response.json()) as { detail?: string };
				detail = errorData?.detail;
			} catch (error) {
				// Ignore JSON parse errors
			}

			lastError = new Error(detail ?? `Failed to get track (status ${response.status})`);
			const shouldRetry = detail ? /quality not found/i.test(detail) : response.status >= 500;

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
		if (!response.ok) throw new Error('Failed to get song');
		return response.json();
	}

	/**
	 * Get album details
	 */
	async getAlbum(id: number): Promise<Album> {
		const response = await this.fetch(`${this.baseUrl}/album/?id=${id}`);
		if (!response.ok) throw new Error('Failed to get album');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
	}

	/**
	 * Get playlist details
	 */
	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		const response = await this.fetch(`${this.baseUrl}/playlist/?id=${uuid}`);
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
		if (!response.ok) throw new Error('Failed to get cover');
		return response.json();
	}

	/**
	 * Get lyrics for a track
	 */
	async getLyrics(id: number): Promise<Lyrics> {
		const response = await this.fetch(`${this.baseUrl}/lyrics/?id=${id}`);
		if (!response.ok) throw new Error('Failed to get lyrics');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
	}

	/**
	 * Get stream URL for a track
	 */
	async getStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		const lookup = await this.getTrack(trackId, quality);
		if (lookup.originalTrackUrl) {
			return lookup.originalTrackUrl;
		}

		const manifestUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
		if (manifestUrl) {
			return manifestUrl;
		}

		throw new Error('Unable to resolve stream URL for track');
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
				response = await this.fetch(streamUrl);
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
				response = await this.fetch(streamUrl);
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
		return `https://resources.tidal.com/images/${coverId.replace(/\-/g, '/')}/${size}x${size}.jpg`;
	}

	/**
	 * Get artist picture URL
	 */
	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		return `https://resources.tidal.com/images/${pictureId.replace(/\-/g, '/')}/${size}x${size}.jpg`;
	}
}

export const tidalAPI = new TidalAPI();
