import { losslessAPI } from '$lib/api';
import type { Album, Track, AudioQuality } from '$lib/types';
import type { DownloadMode } from '$lib/stores/downloadPreferences';
import { formatArtists } from '$lib/utils';
import JSZip from 'jszip';

function detectImageFormat(data: Uint8Array): { extension: string; mimeType: string } | null {
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
	const volumeNumber = Number(track.volumeNumber);
	const trackNumber = Number(track.trackNumber);
	
	// Check if this is a multi-volume album by checking:
	// 1. numberOfVolumes > 1, or
	// 2. volumeNumber is set and finite (indicating multi-volume structure)
	const isMultiVolume = (album.numberOfVolumes && album.numberOfVolumes > 1) || 
	                      Number.isFinite(volumeNumber);
	
	let trackPart: string;
	if (isMultiVolume) {
		const volumePadded = Number.isFinite(volumeNumber) && volumeNumber > 0 ? `${volumeNumber}`.padStart(2, '0') : '01';
		const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
		trackPart = `${volumePadded}-${trackPadded}`;
	} else {
		const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? `${trackNumber}`.padStart(2, '0') : '00';
		trackPart = trackPadded;
	}
	
	const parts = [
		sanitizeForFilename(artistName ?? formatArtists(track.artists)),
		sanitizeForFilename(album.title ?? 'Unknown Album'),
		`${trackPart} ${sanitizeForFilename(track.title)}`
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
			formatArtists(track.artists),
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

		// Download cover separately for ZIP if requested
		if (downloadCoverSeperately && canonicalAlbum.cover) {
			try {
				console.log('[ZIP Cover Download] Fetching cover for album...');
				
				// Try multiple sizes as fallback
				const coverSizes: Array<'1280' | '640' | '320'> = ['1280', '640', '320'];
				let coverDownloadSuccess = false;
				
				for (const size of coverSizes) {
					if (coverDownloadSuccess) break;
					
					const coverUrl = losslessAPI.getCoverUrl(canonicalAlbum.cover, size);
					console.log(`[ZIP Cover Download] Attempting size ${size}:`, coverUrl);
					
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
						
						console.log(`[ZIP Cover Download] Trying strategy: ${strategy.name}`);
					
					try {
						const coverResponse = await fetch(coverUrl, strategy.options);
						
						console.log(`[ZIP Cover Download] Response status: ${coverResponse.status}, Content-Length: ${coverResponse.headers.get('Content-Length')}`);
						
						if (!coverResponse.ok) {
							console.warn(`[ZIP Cover Download] Failed with status ${coverResponse.status} for size ${size}`);
							continue;
						}
						
						const contentType = coverResponse.headers.get('Content-Type');
						const contentLength = coverResponse.headers.get('Content-Length');
						
						if (contentLength && parseInt(contentLength, 10) === 0) {
							console.warn(`[ZIP Cover Download] Content-Length is 0 for size ${size}`);
							continue;
						}
						
						if (contentType && !contentType.startsWith('image/')) {
							console.warn(`[ZIP Cover Download] Invalid content type: ${contentType}`);
							continue;
						}
						
						// Use arrayBuffer directly for more reliable data retrieval
						const arrayBuffer = await coverResponse.arrayBuffer();
						
						if (!arrayBuffer || arrayBuffer.byteLength === 0) {
							console.warn(`[ZIP Cover Download] Empty array buffer for size ${size}`);
							continue;
						}
						
						const uint8Array = new Uint8Array(arrayBuffer);
						console.log(`[ZIP Cover Download] Received ${uint8Array.length} bytes`);
						
						// Detect image format
						const imageFormat = detectImageFormat(uint8Array);
						if (!imageFormat) {
							console.warn(`[ZIP Cover Download] Unknown image format for size ${size}`);
							continue;
						}
						
						// Add cover to ZIP with appropriate filename
						const coverFilename = `cover.${imageFormat.extension}`;
						zip.file(coverFilename, uint8Array, { 
							binary: true,
							compression: 'DEFLATE',
							compressionOptions: { level: 6 }
						});
						
						coverDownloadSuccess = true;
						console.log(`[ZIP Cover Download] Successfully added cover to ZIP (${size}x${size}, format: ${imageFormat.extension}, strategy: ${strategy.name})`);
						break;
					} catch (sizeError) {
						console.warn(`[ZIP Cover Download] Failed at size ${size} with strategy ${strategy.name}:`, sizeError);
					}
					} // End strategy loop
				} // End size loop
				
				if (!coverDownloadSuccess) {
					console.warn('[ZIP Cover Download] All attempts failed');
				}
			} catch (coverError) {
				console.warn('Failed to download cover for ZIP:', coverError);
			}
		}

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
