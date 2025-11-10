import type { Artist } from './types';

/**
 * Formats an array of artists into a readable string for UI display.
 * For single artist: "Artist Name"
 * For multiple artists: "Artist1, Artist2 & Artist3"
 *
 * @param artists - Array of artists
 * @returns Formatted artist string
 */
export function formatArtists(artists: Artist[] | undefined): string {
	if (!artists || artists.length === 0) {
		return 'Unknown Artist';
	}

	if (artists.length === 1) {
		return artists[0].name;
	}

	if (artists.length === 2) {
		return `${artists[0].name} & ${artists[1].name}`;
	}

	// For 3 or more artists: "Artist1, Artist2 & Artist3"
	const allButLast = artists.slice(0, -1).map(a => a.name).join(', ');
	const last = artists[artists.length - 1].name;
	return `${allButLast} & ${last}`;
}

/**
 * Formats an array of artists for metadata tags (ID3, etc.).
 * Uses semicolons as the standard delimiter.
 * For single artist: "Artist Name"
 * For multiple artists: "Artist1; Artist2; Artist3"
 *
 * @param artists - Array of artists
 * @returns Formatted artist string for metadata
 */
export function formatArtistsForMetadata(artists: Artist[] | undefined): string {
	if (!artists || artists.length === 0) {
		return 'Unknown Artist';
	}

	return artists.map(a => a.name).join('; ');
}
