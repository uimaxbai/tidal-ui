import { losslessAPI } from '$lib/api';
import type { Album, Track, AudioQuality } from '$lib/types';
import type { DownloadMode } from '$lib/stores/downloadPreferences';
import JSZip from 'jszip';

export function sanitizeForFilename(value: string | null | undefined): string {
	if (!value) return 'Unknown';
	return value
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

export function getExtensionForQuality(quality: AudioQuality, convertAacToMp3 = false): string {
	switch (quality) {
		case 'LOW':
		case 'HIGH':
			return convertAacToMp3 ? 'mp3' : 'm4a';
		default:
			return 'flac';
	}
}

export function buildTrackFilename(
	album: Album,
	track: Track,
	quality: AudioQuality,
	artistName?: string,
	convertAacToMp3 = false
): string {
	const extension = getExtensionForQuality(quality, convertAacToMp3);
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

function escapeCsvValue(value: string): string {
	const normalized = value.replace(/\r?\n|\r/g, ' ');
	if (/[",]/.test(normalized)) {
		return `"${normalized.replace(/"/g, '""')}"`;
	}
	return normalized;
}

export async function buildTrackLinksCsv(tracks: Track[], quality: AudioQuality): Promise<string> {
	const header = ['Index', 'Title', 'Artist', 'Album', 'Duration', 'FLAC URL'];
	const rows: string[][] = [];

	for (const [index, track] of tracks.entries()) {
		const streamUrl = await losslessAPI.getTrackStreamUrl(track.id, quality);
		rows.push([
			`${index + 1}`,
			track.title ?? '',
			track.artist?.name ?? '',
			track.album?.title ?? '',
			losslessAPI.formatDuration(track.duration ?? 0),
			streamUrl
		]);
	}

	return [header, ...rows]
		.map((row) => row.map((value) => escapeCsvValue(String(value ?? ''))).join(','))
		.join('\n');
}

function triggerFileDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export async function downloadAlbum(
	album: Album,
	quality: AudioQuality,
	callbacks?: AlbumDownloadCallbacks,
	preferredArtistName?: string,
	options?: { mode?: DownloadMode; convertAacToMp3?: boolean; downloadCoverSeperately?: boolean }
): Promise<void> {
	const { album: fetchedAlbum, tracks } = await losslessAPI.getAlbum(album.id);
	const canonicalAlbum = fetchedAlbum ?? album;
	const total = tracks.length;
	callbacks?.onTotalResolved?.(total);
	const mode = options?.mode ?? 'individual';
	const shouldZip = mode === 'zip' && total > 1;
	const useCsv = mode === 'csv';
	const convertAacToMp3 = options?.convertAacToMp3 ?? false;
	const downloadCoverSeperately = options?.downloadCoverSeperately ?? false;
	const artistName = sanitizeForFilename(
		preferredArtistName ?? canonicalAlbum.artist?.name ?? 'Unknown Artist'
	);
	const albumTitle = sanitizeForFilename(canonicalAlbum.title ?? 'Unknown Album');

	if (useCsv) {
		let completed = 0;
		for (const track of tracks) {
			completed += 1;
			callbacks?.onTrackDownloaded?.(completed, total, track);
		}
		const csvContent = await buildTrackLinksCsv(tracks, quality);
		const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		triggerFileDownload(csvBlob, `${artistName} - ${albumTitle}.csv`);
		return;
	}

	if (shouldZip) {
		const zip = new JSZip();
		let completed = 0;
		for (const track of tracks) {
			const filename = buildTrackFilename(
				canonicalAlbum,
				track,
				quality,
				preferredArtistName,
				convertAacToMp3
			);
			const { blob } = await losslessAPI.fetchTrackBlob(track.id, quality, filename, {
				ffmpegAutoTriggered: false,
				convertAacToMp3
			});
			zip.file(filename, blob);
			completed += 1;
			callbacks?.onTrackDownloaded?.(completed, total, track);
		}

		const zipBlob = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});
		triggerFileDownload(zipBlob, `${artistName} - ${albumTitle}.zip`);
		return;
	}

	let completed = 0;

	for (const track of tracks) {
		const filename = buildTrackFilename(
			canonicalAlbum,
			track,
			quality,
			preferredArtistName,
			convertAacToMp3
		);
		await losslessAPI.downloadTrack(track.id, quality, filename, {
			convertAacToMp3,
			downloadCoverSeperately
		});
		completed += 1;
		callbacks?.onTrackDownloaded?.(completed, total, track);
	}
}
