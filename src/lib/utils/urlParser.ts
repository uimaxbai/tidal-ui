/**
 * Utility functions for parsing Tidal URLs
 */

export type TidalUrlType = 'track' | 'album' | 'artist' | 'playlist' | 'unknown';

export interface TidalUrlParseResult {
	type: TidalUrlType;
	trackId?: number;
	albumId?: number;
	artistId?: number;
	playlistId?: string;
}

/**
 * Parse a Tidal URL and extract the relevant IDs
 *
 * Supported URL formats:
 * - Track: https://tidal.com/album/{albumId}/track/{trackId}
 * - Album: https://tidal.com/album/{albumId}
 * - Artist: https://tidal.com/artist/{artistId}
 * - Playlist: https://tidal.com/playlist/{playlistId}
 *
 * Also supports:
 * - listen.tidal.com domain
 * - browse/ prefix (e.g., https://tidal.com/browse/track/{trackId})
 */
export function parseTidalUrl(url: string): TidalUrlParseResult {
	try {
		// Clean up the URL - remove whitespace
		const cleanUrl = url.trim();

		// Parse the URL
		let urlObj: URL;
		try {
			urlObj = new URL(cleanUrl);
		} catch {
			// If it's not a valid URL, try adding https://
			urlObj = new URL(`https://${cleanUrl}`);
		}

		// Check if it's a Tidal domain
		const hostname = urlObj.hostname.toLowerCase();
		if (!hostname.includes('tidal.com')) {
			return { type: 'unknown' };
		}

		const pathname = urlObj.pathname;

		// Track URL patterns:
		// /album/{albumId}/track/{trackId}
		// /browse/track/{trackId}
		const trackMatch = pathname.match(/\/(?:album\/\d+\/)?track\/(\d+)/);
		if (trackMatch) {
			const trackId = parseInt(trackMatch[1]!, 10);
			if (!isNaN(trackId)) {
				// Also try to extract album ID if present
				const albumMatch = pathname.match(/\/album\/(\d+)\//);
				const albumId = albumMatch ? parseInt(albumMatch[1]!, 10) : undefined;

				return {
					type: 'track',
					trackId,
					albumId: albumId && !isNaN(albumId) ? albumId : undefined
				};
			}
		}

		// Album URL pattern: /album/{albumId}
		const albumMatch = pathname.match(/\/album\/(\d+)(?:\/|$)/);
		if (albumMatch) {
			const albumId = parseInt(albumMatch[1]!, 10);
			if (!isNaN(albumId)) {
				return {
					type: 'album',
					albumId
				};
			}
		}

		// Artist URL pattern: /artist/{artistId}
		const artistMatch = pathname.match(/\/artist\/(\d+)/);
		if (artistMatch) {
			const artistId = parseInt(artistMatch[1]!, 10);
			if (!isNaN(artistId)) {
				return {
					type: 'artist',
					artistId
				};
			}
		}

		// Playlist URL pattern: /playlist/{playlistId}
		// Note: Playlist IDs are UUIDs (strings), not numbers
		const playlistMatch = pathname.match(/\/playlist\/([a-f0-9-]+)/i);
		if (playlistMatch) {
			return {
				type: 'playlist',
				playlistId: playlistMatch[1]!
			};
		}

		return { type: 'unknown' };
	} catch (error) {
		console.error('Failed to parse Tidal URL:', error);
		return { type: 'unknown' };
	}
}

/**
 * Validate if a string looks like a Tidal URL
 */
export function isTidalUrl(url: string): boolean {
	const cleaned = url.trim().toLowerCase();
	return cleaned.includes('tidal.com') &&
	       (cleaned.startsWith('http://') ||
	        cleaned.startsWith('https://') ||
	        cleaned.startsWith('tidal.com') ||
	        cleaned.startsWith('listen.tidal.com'));
}
