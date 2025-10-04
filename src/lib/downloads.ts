import { losslessAPI } from '$lib/api';
import type { Album, Track, AudioQuality } from '$lib/types';

export function sanitizeForFilename(value: string | null | undefined): string {
	if (!value) return 'Unknown';
	return value
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

export function getExtensionForQuality(quality: AudioQuality): string {
	switch (quality) {
		case 'LOW':
		case 'HIGH':
			return 'mp3';
		default:
			return 'flac';
	}
}

export function buildTrackFilename(
	album: Album,
	track: Track,
	quality: AudioQuality,
	artistName?: string
): string {
	const extension = getExtensionForQuality(quality);
	const trackNumber = Number(track.trackNumber);
	const padded =
		Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
	const parts = [
		sanitizeForFilename(artistName ?? track.artist?.name ?? 'Unknown Artist'),
		sanitizeForFilename(album.title ?? 'Unknown Album'),
		`${padded} ${sanitizeForFilename(track.title)}`
	];
	return `${parts.join(' - ')}.${extension}`;
}

export interface AlbumDownloadCallbacks {
	onTotalResolved?(total: number): void;
	onTrackDownloaded?(completed: number, total: number, track: Track): void;
}

export async function downloadAlbum(
	album: Album,
	quality: AudioQuality,
	callbacks?: AlbumDownloadCallbacks,
	preferredArtistName?: string
): Promise<void> {
	const { album: fetchedAlbum, tracks } = await losslessAPI.getAlbum(album.id);
	const canonicalAlbum = fetchedAlbum ?? album;
	const total = tracks.length;
	callbacks?.onTotalResolved?.(total);

	let completed = 0;

	for (const track of tracks) {
		const filename = buildTrackFilename(canonicalAlbum, track, quality, preferredArtistName);
		await losslessAPI.downloadTrack(track.id, quality, filename);
		completed += 1;
		callbacks?.onTrackDownloaded?.(completed, total, track);
	}
}
