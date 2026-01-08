<script lang="ts">
	import type { Track } from '$lib/types';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import { getExtensionForQuality, buildTrackFilename } from '$lib/downloads';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { formatArtists } from '$lib/utils';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { Play, Pause, Download, Clock, Plus, ListPlus, X } from 'lucide-svelte';

	interface Props {
		tracks: Track[];
		showAlbum?: boolean;
		showArtist?: boolean;
		showCover?: boolean;
	}

	let { tracks, showAlbum = true, showArtist = true, showCover = true }: Props = $props();
	let downloadingIds = $state(new Set<number>());
	let downloadTaskIds = $state(new Map<number, string>());
	let cancelledIds = $state(new Set<number>());
	const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoverSeperatelyPreference = $derived($userPreferencesStore.downloadCoversSeperately);

	function getDisplayTags(tags?: string[] | null): string[] {
		if (!tags) return [];
		return tags.filter((tag) => tag && !IGNORED_TAGS.has(tag));
	}

	function formatTrackNumber(track: Track): string {
		const volumeNumber = Number(track.volumeNumber);
		const trackNumber = Number(track.trackNumber);
		
		// Check if this is a multi-volume album by checking:
		// 1. numberOfVolumes > 1, or
		// 2. volumeNumber is set and finite (indicating multi-volume structure)
		const isMultiVolume = (track.album?.numberOfVolumes && track.album.numberOfVolumes > 1) || 
		                      Number.isFinite(volumeNumber);
		
		if (isMultiVolume) {
			const volumePadded = Number.isFinite(volumeNumber) && volumeNumber > 0 ? volumeNumber.toString() : '1';
			const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber.toString() : '0';
			return `${volumePadded}-${trackPadded}`;
		} else {
			const trackPadded = Number.isFinite(trackNumber) && trackNumber > 0 ? trackNumber.toString() : '0';
			return trackPadded;
		}
	}

	function handlePlayTrack(track: Track, index: number) {
		playerStore.setQueue(tracks, index);
		playerStore.play();
	}

	function handleAddToQueue(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playerStore.enqueue(track);
	}

	function handlePlayNext(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playerStore.enqueueNext(track);
	}

	function markCancelled(trackId: number) {
		const next = new Set(cancelledIds);
		next.add(trackId);
		cancelledIds = next;
		setTimeout(() => {
			const updated = new Set(cancelledIds);
			updated.delete(trackId);
			cancelledIds = updated;
		}, 1500);
	}

	function handleCancelDownload(trackId: number, event: MouseEvent) {
		event.stopPropagation();
		const taskId = downloadTaskIds.get(trackId);
		if (taskId) {
			downloadUiStore.cancelTrackDownload(taskId);
		}
		const next = new Set(downloadingIds);
		next.delete(trackId);
		downloadingIds = next;
		const nextTasks = new Map(downloadTaskIds);
		nextTasks.delete(trackId);
		downloadTaskIds = nextTasks;
		markCancelled(trackId);
	}

	async function handleDownload(track: Track, event: MouseEvent) {
		event.stopPropagation();
		const next = new Set(downloadingIds);
		next.add(track.id);
		downloadingIds = next;

		const quality = $playerStore.quality;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3Preference
		);
		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: showAlbum ? (track.album?.title ?? track.artist?.name) : track.artist?.name
		});
		const taskMap = new Map(downloadTaskIds);
		taskMap.set(track.id, taskId);
		downloadTaskIds = taskMap;
		downloadUiStore.skipFfmpegCountdown();

		try {
			await losslessAPI.downloadTrack(track.id, quality, filename, {
				signal: controller.signal,
				onProgress: (progress: TrackDownloadProgress) => {
					if (progress.stage === 'downloading') {
						downloadUiStore.updateTrackProgress(
							taskId,
							progress.receivedBytes,
							progress.totalBytes
						);
					} else {
						downloadUiStore.updateTrackStage(taskId, progress.progress);
					}
				},
				onFfmpegCountdown: ({ totalBytes }) => {
					if (typeof totalBytes === 'number') {
						downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered: false });
					} else {
						downloadUiStore.startFfmpegCountdown(0, { autoTriggered: false });
					}
				},
				onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
				onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
				onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
				onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
				ffmpegAutoTriggered: false,
				convertAacToMp3: convertAacToMp3Preference,
				downloadCoverSeperately: downloadCoverSeperatelyPreference
			});
			downloadUiStore.completeTrackDownload(taskId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId);
				markCancelled(track.id);
			} else {
				console.error('Failed to download track:', error);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = error instanceof Error && error.message ? error.message : fallbackMessage;
				downloadUiStore.errorTrackDownload(taskId, message);
				alert(message);
			}
		} finally {
			const updated = new Set(downloadingIds);
			updated.delete(track.id);
			downloadingIds = updated;
			const ids = new Map(downloadTaskIds);
			ids.delete(track.id);
			downloadTaskIds = ids;
		}
	}

	function isCurrentTrack(track: Track): boolean {
		return $playerStore.currentTrack?.id === track.id;
	}

	function isPlaying(track: Track): boolean {
		return isCurrentTrack(track) && $playerStore.isPlaying;
	}
</script>

<div class="track-list">
	{#if tracks.length === 0}
		<div class="track-list__empty">
			<p>No tracks available</p>
		</div>
	{:else}
		<div class="track-list__items">
			{#each tracks as track, index}
				<div
					class="track-row {isCurrentTrack(track) ? 'track-row--active' : ''}"
				>
					<!-- Track Number / Play Button -->
					<button
						onclick={() => handlePlayTrack(track, index)}
						class="track-row__play-btn touch-target"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={18} class="track-row__icon--active" />
						{:else if isCurrentTrack(track)}
							<Play size={18} class="track-row__icon--active" />
						{:else}
							<span class="track-row__number">{formatTrackNumber(track)}</span>
							<Play size={18} class="track-row__icon--hover" />
						{/if}
					</button>

					<!-- Cover -->
					{#if showCover && track.album.cover}
						<img
							src={losslessAPI.getCoverUrl(track.album.cover, '320')}
							alt={track.title}
							class="track-row__cover"
							loading="lazy"
						/>
					{/if}

					<!-- Track Info -->
					<div class="track-row__info">
						<button
							onclick={() => handlePlayTrack(track, index)}
							class="track-row__title {isCurrentTrack(track) ? 'track-row__title--active' : ''}"
						>
							{track.title}
							{#if track.explicit}
								<svg
									class="track-row__explicit"
									xmlns="http://www.w3.org/2000/svg"
									fill="currentColor"
									height="24"
									viewBox="0 0 24 24"
									width="24"
									focusable="false"
									aria-hidden="true"
									><path
										d="M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM8 6h8a1 1 0 110 2H9v3h5a1 1 0 010 2H9v3h7a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1Z"
									></path></svg
								>
							{/if}
						</button>
						<div class="track-row__meta">
							{#if showArtist}
								<span class="track-row__artist">{formatArtists(track.artists)}</span>
							{/if}
							{#if showAlbum && showArtist}
								<span class="track-row__sep">•</span>
							{/if}
							{#if showAlbum}
								<span class="track-row__album">{track.album.title}</span>
							{/if}
						</div>
						{#if getDisplayTags(track.mediaMetadata?.tags).length > 0}
							<div class="track-row__tags">
								• {getDisplayTags(track.mediaMetadata?.tags).join(', ')}
							</div>
						{/if}
					</div>

					<!-- Actions -->
					<div class="track-row__actions">
						<button
							onclick={(event) => handlePlayNext(track, event)}
							class="track-row__action-btn touch-target"
							title="Play next"
							aria-label={`Play ${track.title} next`}
						>
							<ListPlus size={20} />
						</button>
						<button
							onclick={(event) => handleAddToQueue(track, event)}
							class="track-row__action-btn touch-target"
							title="Add to queue"
							aria-label={`Add ${track.title} to queue`}
						>
							<Plus size={20} />
						</button>
						
						<div class="track-row__action-btn">
							<ShareButton type="track" id={track.id} iconOnly size={20} title="Share track" />
						</div>

						<button
							onclick={(e) =>
								downloadingIds.has(track.id)
									? handleCancelDownload(track.id, e)
									: handleDownload(track, e)}
							class="track-row__action-btn touch-target"
							aria-label={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
							title={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
							aria-busy={downloadingIds.has(track.id)}
						>
							{#if downloadingIds.has(track.id)}
								<span class="track-row__spinner">
									{#if cancelledIds.has(track.id)}
										<X size={16} />
									{:else}
										<span class="track-row__loading"></span>
									{/if}
								</span>
							{:else if cancelledIds.has(track.id)}
								<X size={20} />
							{:else}
								<Download size={20} />
							{/if}
						</button>

						<!-- Duration -->
						<div class="track-row__duration">
							<Clock size={14} />
							{losslessAPI.formatDuration(track.duration)}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.track-list {
		width: 100%;
		contain: content;
	}

	.track-list__empty {
		padding: var(--space-12, 3rem) 0;
		text-align: center;
		color: rgba(148, 163, 184, 0.8);
	}

	.track-list__items {
		display: flex;
		flex-direction: column;
		gap: var(--space-1, 0.25rem);
	}

	/* Track Row - Performance optimized (no backdrop-filter) */
	.track-row {
		display: flex;
		align-items: center;
		gap: var(--space-3, 0.75rem);
		padding: var(--space-3, 0.75rem);
		border-radius: var(--radius-lg, 0.75rem);
		background: rgba(15, 23, 42, 0.4);
		border: 1px solid rgba(148, 163, 184, 0.08);
		transition: 
			background var(--transition-fast, 150ms ease),
			border-color var(--transition-fast, 150ms ease);
		contain: layout style;
	}

	.track-row:hover {
		background: rgba(30, 41, 59, 0.6);
		border-color: rgba(148, 163, 184, 0.15);
	}

	.track-row--active {
		background: rgba(59, 130, 246, 0.12);
		border-color: rgba(59, 130, 246, 0.25);
		border-left: 3px solid rgba(59, 130, 246, 0.8);
	}

	/* Play Button */
	.track-row__play-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		background: none;
		border: none;
		color: inherit;
		border-radius: var(--radius-md, 0.5rem);
		transition: background var(--transition-fast, 150ms ease);
	}

	.track-row__play-btn:hover {
		background: rgba(148, 163, 184, 0.1);
	}

	.track-row__number {
		font-size: 0.875rem;
		color: rgba(148, 163, 184, 0.7);
	}

	.track-row__icon--hover {
		display: none;
		color: #f8fafc;
	}

	.track-row__icon--active {
		color: #3b82f6;
	}

	.track-row:hover .track-row__number {
		display: none;
	}

	.track-row:hover .track-row__icon--hover {
		display: block;
	}

	/* Cover */
	.track-row__cover {
		width: 3.5rem;
		height: 3.5rem;
		flex-shrink: 0;
		border-radius: var(--radius-md, 0.5rem);
		object-fit: cover;
	}

	/* Track Info */
	.track-row__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1, 0.25rem);
		overflow: hidden;
	}

	.track-row__title {
		display: block;
		font-weight: 500;
		font-size: 0.9375rem;
		color: #f1f5f9;
		background: none;
		border: none;
		text-align: left;
		width: 100%;
		padding: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color var(--transition-fast, 150ms ease);
		cursor: pointer;
	}

	.track-row:hover .track-row__title {
		color: #60a5fa;
	}

	.track-row__title--active {
		color: #3b82f6;
	}

	.track-row__explicit {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		opacity: 0.6;
	}

	.track-row__meta {
		display: flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		font-size: 0.8125rem;
		color: rgba(148, 163, 184, 0.8);
		overflow: hidden;
	}

	.track-row__artist,
	.track-row__album {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 45%;
	}

	.track-row__sep {
		flex-shrink: 0;
	}

	.track-row__tags {
		font-size: 0.75rem;
		color: rgba(100, 116, 139, 0.8);
	}

	/* Actions */
	.track-row__actions {
		display: flex;
		align-items: center;
		gap: var(--space-1, 0.25rem);
		flex-shrink: 0;
	}

	.track-row__action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md, 0.5rem);
		background: none;
		border: none;
		color: rgba(148, 163, 184, 0.7);
		transition: 
			color var(--transition-fast, 150ms ease),
			background var(--transition-fast, 150ms ease);
	}

	.track-row__action-btn:hover {
		color: #f8fafc;
		background: rgba(148, 163, 184, 0.1);
	}

	.track-row__spinner {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
	}

	.track-row__loading {
		width: 1rem;
		height: 1rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.track-row__duration {
		display: flex;
		align-items: center;
		gap: var(--space-1, 0.25rem);
		width: 4rem;
		justify-content: flex-end;
		font-size: 0.8125rem;
		color: rgba(148, 163, 184, 0.7);
	}

	/* Mobile optimizations */
	@media (max-width: 640px) {
		.track-row {
			padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
		}

		.track-row__cover {
			width: 2.75rem;
			height: 2.75rem;
		}

		.track-row__title {
			font-size: 0.875rem;
		}

		.track-row__meta {
			font-size: 0.75rem;
		}

		/* Hide less important actions on mobile */
		.track-row__action-btn:nth-child(1),
		.track-row__action-btn:nth-child(2) {
			display: none;
		}

		.track-row__duration {
			width: auto;
			font-size: 0.75rem;
		}
	}

	/* Touch device active state */
	@media (pointer: coarse) {
		.track-row:active {
			background: rgba(59, 130, 246, 0.15);
		}
	}
</style>

