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

	let title = track.title;
	if (track.version) {
		title = `${title} (${track.version})`;
	}

	const parts = [
		sanitizeForFilename(artistName ?? formatArtists(track.artists)),
		sanitizeForFilename(album.title ?? 'Unknown Album'),
		`${trackPart} ${sanitizeForFilename(title)}`
	];
	return `${parts.join(' - ')}.${extension}`;
}

export interface AlbumDownloadCallbacks {
	onTotalResolved?(total: number): void;
	onTrackDownloaded?(completed: number, total: number, track: Track): void;
	onTrackFailed?(track: Track, error: Error, attempt: number): void;
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

interface DownloadTrackResult {
	success: boolean;
	blob?: Blob;
	error?: Error;
}

async function downloadTrackWithRetry(
	trackId: number,
	quality: AudioQuality,
	filename: string,
	track: Track,
	callbacks?: AlbumDownloadCallbacks,
	options?: { convertAacToMp3?: boolean; downloadCoverSeperately?: boolean }
): Promise<DownloadTrackResult> {
	const maxAttempts = 3;
	const baseDelay = 1000; // 1 second
	const trackTitle = track.title ?? 'Unknown Track';
	const artistName = formatArtists(track.artists);

	console.log(`[Track Download] Starting download: "${trackTitle}" by ${artistName} (ID: ${trackId}, Quality: ${quality})`);

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			if (attempt > 1) {
				console.log(`[Track Download] Retry attempt ${attempt}/${maxAttempts} for "${trackTitle}"`);
			}

			const { blob } = await losslessAPI.fetchTrackBlob(trackId, quality, filename, {
				ffmpegAutoTriggered: false,
				convertAacToMp3: options?.convertAacToMp3
			});

			console.log(`[Track Download] ✓ Success: "${trackTitle}" (${(blob.size / 1024 / 1024).toFixed(2)} MB)${attempt > 1 ? ` - succeeded on attempt ${attempt}` : ''}`);
			return { success: true, blob };
		} catch (error) {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			console.warn(
				`[Track Download] ✗ Attempt ${attempt}/${maxAttempts} failed for "${trackTitle}": ${errorObj.message}`
			);

			callbacks?.onTrackFailed?.(track, errorObj, attempt);

			if (attempt < maxAttempts) {
				// Exponential backoff: 1s, 2s, 4s
				const delay = baseDelay * Math.pow(2, attempt - 1);
				console.log(`[Track Download] Waiting ${delay}ms before retry...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				console.error(
					`[Track Download] ✗✗✗ All ${maxAttempts} attempts failed for "${trackTitle}" - giving up`
				);
				return { success: false, error: errorObj };
			}
		}
	}

	return { success: false, error: new Error('Download failed after all retry attempts') };
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

	console.log(`[Album Download] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
	console.log(`[Album Download] Starting: "${albumTitle}" by ${artistName}`);
	console.log(`[Album Download] Tracks: ${total} | Quality: ${quality} | Mode: ${mode}`);
	console.log(`[Album Download] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);


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
		const failedTracks: Array<{ track: Track; error: Error }> = [];

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

			const result = await downloadTrackWithRetry(
				track.id,
				quality,
				filename,
				track,
				callbacks,
				{ convertAacToMp3 }
			);

			if (result.success && result.blob) {
				zip.file(filename, result.blob);
			} else {
				console.error(`[ZIP Download] Track failed: ${track.title}`, result.error);
				failedTracks.push({ track, error: result.error ?? new Error('Unknown error') });
			}

			completed += 1;
			callbacks?.onTrackDownloaded?.(completed, total, track);
		}

		// Add error report file if there were failures
		if (failedTracks.length > 0) {
			let errorReport = 'DOWNLOAD ERRORS\n';
			errorReport += '===============\n\n';
			errorReport += 'The following tracks failed to download after 3 attempts:\n\n';

			failedTracks.forEach((item, index) => {
				const { track, error } = item;
				const trackTitle = track.title ?? 'Unknown Track';
				const artistName = formatArtists(track.artists);
				errorReport += `${index + 1}. ${trackTitle} - ${artistName}\n`;
				errorReport += `   Error: ${error.message}\n\n`;
			});

			zip.file('_DOWNLOAD_ERRORS.txt', errorReport);
			console.log(`[ZIP Download] Added error report with ${failedTracks.length} failed track(s)`);
		}

		const zipBlob = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});

		const successCount = completed - failedTracks.length;
		console.log(`[Album Download] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
		console.log(`[Album Download] ZIP Complete: "${albumTitle}"`);
		console.log(`[Album Download] ✓ Success: ${successCount}/${total} tracks | ZIP size: ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB`);
		if (failedTracks.length > 0) {
			console.log(`[Album Download] ✗ Failed: ${failedTracks.length} track(s) - see _DOWNLOAD_ERRORS.txt in ZIP`);
		}
		console.log(`[Album Download] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

		triggerFileDownload(zipBlob, `${artistName} - ${albumTitle}.zip`);
		return;
	}

	let completed = 0;
	let failedCount = 0;

	for (const track of tracks) {
		const filename = buildTrackFilename(
			canonicalAlbum,
			track,
			quality,
			preferredArtistName,
			convertAacToMp3
		);

		const result = await downloadTrackWithRetry(
			track.id,
			quality,
			filename,
			track,
			callbacks,
			{ convertAacToMp3, downloadCoverSeperately }
		);

		if (result.success && result.blob) {
			// Trigger individual download
			const url = URL.createObjectURL(result.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			// Download cover separately if enabled
			if (downloadCoverSeperately && track.album?.cover) {
				try {
					const coverId = track.album.cover;
					const coverSizes: Array<'1280' | '640' | '320'> = ['1280', '640', '320'];
					let coverDownloadSuccess = false;

					for (const size of coverSizes) {
						if (coverDownloadSuccess) break;

						const coverUrl = losslessAPI.getCoverUrl(coverId, size);
						const fetchStrategies = [
							{
								name: 'with-headers',
								options: {
									method: 'GET' as const,
									headers: {
										'Accept': 'image/jpeg,image/jpg,image/png,image/*',
										'User-Agent':
											'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

							try {
								const coverResponse = await fetch(coverUrl, strategy.options);

								if (!coverResponse.ok) continue;

								const contentType = coverResponse.headers.get('Content-Type');
								const contentLength = coverResponse.headers.get('Content-Length');

								if (contentLength && parseInt(contentLength, 10) === 0) continue;
								if (contentType && !contentType.startsWith('image/')) continue;

								const arrayBuffer = await coverResponse.arrayBuffer();
								if (!arrayBuffer || arrayBuffer.byteLength === 0) continue;

								const uint8Array = new Uint8Array(arrayBuffer);
								const imageFormat = detectImageFormat(uint8Array);
								if (!imageFormat) continue;

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
								break;
							} catch {
								// Continue to next strategy
							}
						}
					}
				} catch (coverError) {
					console.warn('Failed to download cover separately:', coverError);
				}
			}
		} else {
			console.error(`[Individual Download] Track failed: ${track.title}`, result.error);
			failedCount++;
		}

		completed += 1;
		callbacks?.onTrackDownloaded?.(completed, total, track);
	}

	// Summary logging
	const successCount = total - failedCount;
	console.log(`[Album Download] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
	console.log(`[Album Download] Individual Downloads Complete: "${albumTitle}"`);
	console.log(`[Album Download] ✓ Success: ${successCount}/${total} tracks`);
	if (failedCount > 0) {
		console.log(`[Album Download] ✗ Failed: ${failedCount} track(s)`);
	}
	console.log(`[Album Download] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
