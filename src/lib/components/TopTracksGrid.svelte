<script lang="ts">
	import type { Track } from '$lib/types';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { Play, Pause, Download, ListPlus, Plus, Clock, X } from 'lucide-svelte';

	interface Props {
		tracks: Track[];
		maxTracks?: number;
		columns?: number;
	}

	function getColumnClass(columns: number): string {
		if (columns >= 3) {
			return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
		}
		if (columns === 2) {
			return 'grid-cols-1 sm:grid-cols-2';
		}
		return 'grid-cols-1';
	}

	let { tracks, maxTracks = 6, columns = 3 }: Props = $props();

	const columnClass = $derived(getColumnClass(columns));
	const displayedTracks = $derived(maxTracks ? tracks.slice(0, maxTracks) : tracks);

	let downloadingIds = $state(new Set<number>());
	let downloadTaskIds = $state(new Map<number, string>());
	let cancelledIds = $state(new Set<number>());

	const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);

	function getDisplayTags(tags?: string[] | null): string[] {
		if (!tags) return [];
		return tags.filter((tag) => tag && !IGNORED_TAGS.has(tag));
	}

	function handlePlayTrack(track: Track, index: number) {
		playerStore.setQueue(displayedTracks, index);
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

	function handleCardKeydown(event: KeyboardEvent, track: Track, index: number) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handlePlayTrack(track, index);
		}
	}

	function isCurrentTrack(track: Track): boolean {
		return $playerStore.currentTrack?.id === track.id;
	}

	function isPlaying(track: Track): boolean {
		return isCurrentTrack(track) && $playerStore.isPlaying;
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
		const taskMap = new Map(downloadTaskIds);
		taskMap.delete(trackId);
		downloadTaskIds = taskMap;
		markCancelled(trackId);
	}

	async function handleDownload(track: Track, event: MouseEvent) {
		event.stopPropagation();
		const next = new Set(downloadingIds);
		next.add(track.id);
		downloadingIds = next;

		const filename = `${track.artist.name} - ${track.title}.flac`;
		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: track.album?.title ?? track.artist?.name
		});
		const taskMap = new Map(downloadTaskIds);
		taskMap.set(track.id, taskId);
		downloadTaskIds = taskMap;
		downloadUiStore.skipFfmpegCountdown();

		try {
			await losslessAPI.downloadTrack(track.id, $playerStore.quality, filename, {
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
				ffmpegAutoTriggered: false
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
</script>

<div class={`grid gap-4 ${columnClass}`}>
	{#if displayedTracks.length === 0}
		<div class="col-span-full py-12 text-center text-gray-400">
			<p>No tracks available</p>
		</div>
	{:else}
		{#each displayedTracks as track, index (track.id)}
			<div
				role="button"
				tabindex="0"
				onclick={() => handlePlayTrack(track, index)}
				onkeydown={(event) => handleCardKeydown(event, track, index)}
				class="group flex h-full cursor-pointer flex-col gap-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4 transition-colors hover:border-blue-700 hover:bg-gray-900/70 focus:outline-none focus:ring-2 focus:ring-blue-500"
			>
				<div class="flex items-start gap-4">
					<button
						onclick={(event) => {
							event.stopPropagation();
							handlePlayTrack(track, index);
						}}
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 transition-transform hover:scale-110"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={18} class="text-blue-500" />
						{:else if isCurrentTrack(track)}
							<Play size={18} class="text-blue-500" />
						{:else}
							<span class="text-sm font-semibold text-gray-300">{index + 1}</span>
						{/if}
					</button>

					{#if track.album?.cover}
						<img
							src={losslessAPI.getCoverUrl(track.album.cover, '320')}
							alt={track.title}
							class="h-20 w-20 flex-shrink-0 rounded-lg object-cover shadow-lg"
						/>
					{/if}

					<div class="min-w-0 flex-1">
						<h3
							class="truncate text-lg font-semibold {isCurrentTrack(track)
								? 'text-blue-500'
								: 'text-white group-hover:text-blue-400'}"
						>
							{track.title}
							{#if track.explicit}
								<span class="ml-1 text-xs text-gray-500">[E]</span>
							{/if}
						</h3>
						<div class="mt-1 space-y-1 text-sm text-gray-400">
							<p class="truncate">{track.artist.name}</p>
							{#if track.album}
								<p class="truncate text-xs text-gray-500">{track.album.title}</p>
							{/if}
						</div>
						{#if getDisplayTags(track.mediaMetadata?.tags).length > 0}
							<p class="mt-2 text-xs text-gray-500">
								{getDisplayTags(track.mediaMetadata?.tags).join(', ')}
							</p>
						{/if}
					</div>
				</div>

				<div class="mt-auto flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
					<div class="flex items-center gap-2">
						<button
							onclick={(event) => handlePlayNext(track, event)}
							class="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
							title="Play next"
							aria-label={`Play ${track.title} next`}
						>
							<ListPlus size={18} />
						</button>
						<button
							onclick={(event) => handleAddToQueue(track, event)}
							class="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
							title="Add to queue"
							aria-label={`Add ${track.title} to queue`}
						>
							<Plus size={18} />
						</button>
						<button
							onclick={(event) =>
								downloadingIds.has(track.id)
								? handleCancelDownload(track.id, event)
								: handleDownload(track, event)
						}
						class="rounded-full p-2 transition-colors hover:bg-gray-800 hover:text-white"
						title={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
						aria-label={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
						aria-busy={downloadingIds.has(track.id)}
						aria-pressed={downloadingIds.has(track.id)}
					>
						{#if downloadingIds.has(track.id)}
							<span class="flex h-4 w-4 items-center justify-center">
								{#if cancelledIds.has(track.id)}
									<X size={14} />
								{:else}
									<span
										class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
									></span>
								{/if}
							</span>
						{:else if cancelledIds.has(track.id)}
							<X size={18} />
						{:else}
							<Download size={18} />
						{/if}
					</button>
					</div>
					<div class="flex items-center gap-1 text-xs text-gray-400">
						<Clock size={14} />
						<span>{losslessAPI.formatDuration(track.duration)}</span>
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>
