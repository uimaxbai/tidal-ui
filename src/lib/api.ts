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
	TrackInfo
} from './types';

const API_BASE = API_CONFIG.baseUrl;

class TidalAPI {
	public baseUrl: string;

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
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
	 * Get track info and stream URL
	 */
	async getTrack(id: number, quality: AudioQuality = 'LOSSLESS'): Promise<TrackInfo> {
		const response = await this.fetch(
			`${this.baseUrl}/track/?id=${id}&quality=${quality}`
		);
		if (!response.ok) throw new Error('Failed to get track');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
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
	async getPlaylist(
		uuid: string
	): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
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
		const url = full
			? `${this.baseUrl}/artist/?f=${id}`
			: `${this.baseUrl}/artist/?id=${id}`;
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
	 * The HIFI API returns the actual TIDAL CDN URL which is CORS-friendly
	 */
	async getStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		const response = await this.getTrack(trackId, quality);
		// The API returns the track info, but we need to parse the manifest
		// For now, we'll construct a direct stream URL through the API
		// The HIFI API acts as a proxy and returns CORS-friendly URLs
		return `${this.baseUrl}/stream/${trackId}?quality=${quality}`;
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
			// Get track info with stream URL
			const trackInfo = await this.getTrack(trackId, quality);
			
			// Decode the manifest to get the actual stream URL
			const decoded = atob(trackInfo.manifest);
			const urlMatch = decoded.match(/https?:\/\/[^\s<>"]+/);
			
			if (!urlMatch) {
				throw new Error('Could not extract stream URL from manifest');
			}
			
			const streamUrl = urlMatch[0];
			
			// Fetch the audio file
			// Note: The TIDAL CDN URLs should be CORS-friendly
			// If you still get CORS errors, you'll need to proxy through a backend
			const response = await this.fetch(streamUrl);
			
			if (!response.ok) {
				throw new Error('Failed to fetch audio stream');
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
