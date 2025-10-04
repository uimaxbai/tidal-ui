<script lang="ts">
	import type { Track } from '$lib/types';
	import { losslessAPI } from '$lib/api';
	import { playerStore } from '$lib/stores/player';
	import { Play, Pause, Download, Clock, Plus, ListPlus } from 'lucide-svelte';

	interface Props {
		tracks: Track[];
		showAlbum?: boolean;
		showArtist?: boolean;
		showCover?: boolean;
	}

	let { tracks, showAlbum = true, showArtist = true, showCover = true }: Props = $props();
	let downloadingIds = $state(new Set<number>());
	const IGNORED_TAGS = new Set(['HI_RES_LOSSLESS']);

	function getDisplayTags(tags?: string[] | null): string[] {
		if (!tags) return [];
		return tags.filter((tag) => tag && !IGNORED_TAGS.has(tag));
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

	async function handleDownload(track: Track, event: MouseEvent) {
		event.stopPropagation();
		const next = new Set(downloadingIds);
		next.add(track.id);
		downloadingIds = next;

		try {
			const filename = `${track.artist.name} - ${track.title}.flac`;
			await losslessAPI.downloadTrack(track.id, $playerStore.quality, filename);
		} catch (error) {
			console.error('Failed to download track:', error);
			const fallbackMessage = 'Failed to download track. Please try again.';
			const message = error instanceof Error && error.message ? error.message : fallbackMessage;
			alert(message);
		} finally {
			const updated = new Set(downloadingIds);
			updated.delete(track.id);
			downloadingIds = updated;
		}
	}

	function isCurrentTrack(track: Track): boolean {
		return $playerStore.currentTrack?.id === track.id;
	}

	function isPlaying(track: Track): boolean {
		return isCurrentTrack(track) && $playerStore.isPlaying;
	}
</script>

<div class="w-full">
	{#if tracks.length === 0}
		<div class="py-12 text-center text-gray-400">
			<p>No tracks available</p>
		</div>
	{:else}
		<div class="space-y-1">
			{#each tracks as track, index}
				<div
					class="group flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors {isCurrentTrack(
						track
					)
						? 'bg-blue-900/20'
						: 'hover:bg-gray-800'}"
				>
					<!-- Track Number / Play Button -->
					<button
						onclick={() => handlePlayTrack(track, index)}
						class="flex w-8 flex-shrink-0 items-center justify-center transition-transform hover:scale-110"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={16} class="text-blue-500" />
						{:else if isCurrentTrack(track)}
							<Play size={16} class="text-blue-500" />
						{:else}
							<span class="text-sm text-gray-400 group-hover:hidden">{index + 1}</span>
							<Play size={16} class="hidden text-white group-hover:block" />
						{/if}
					</button>

					<!-- Cover -->
					{#if showCover && track.album.cover}
						<img
							src={losslessAPI.getCoverUrl(track.album.cover, '320')}
							alt={track.title}
							class="h-16 w-16 flex-shrink-0 rounded object-cover"
						/>
					{/if}

					<!-- Track Info -->
					<div class="min-w-0 flex-1">
						<h3
							class="truncate font-medium {isCurrentTrack(track)
								? 'text-blue-500'
								: 'text-white group-hover:text-blue-400'}"
						>
							{track.title}
							{#if track.explicit}
								<span class="ml-1 text-xs text-gray-500">[E]</span>
							{/if}
						</h3>
						<div class="flex items-center gap-2 text-sm text-gray-400">
							{#if showArtist}
								<span class="truncate">{track.artist.name}</span>
							{/if}
							{#if showAlbum && showArtist}
								<span>•</span>
							{/if}
							{#if showAlbum}
								<span class="truncate">{track.album.title}</span>
							{/if}
						</div>
						<div class="mt-0.5 text-xs text-gray-500">
							{#if getDisplayTags(track.mediaMetadata?.tags).length > 0}
								• {getDisplayTags(track.mediaMetadata?.tags).join(', ')}
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="flex flex-shrink-0 items-center gap-2">
						<button
							onclick={(event) => handlePlayNext(track, event)}
							class="p-2 text-gray-400 transition-colors hover:text-white"
							title="Play next"
							aria-label={`Play ${track.title} next`}
						>
							<ListPlus size={18} />
						</button>
						<button
							onclick={(event) => handleAddToQueue(track, event)}
							class="p-2 text-gray-400 transition-colors hover:text-white"
							title="Add to queue"
							aria-label={`Add ${track.title} to queue`}
						>
							<Plus size={18} />
						</button>
						<button
							onclick={(e) => handleDownload(track, e)}
							class="p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							aria-label="Download track"
							title="Download track"
							disabled={downloadingIds.has(track.id)}
							aria-busy={downloadingIds.has(track.id)}
						>
							{#if downloadingIds.has(track.id)}
								<span class="flex h-4 w-4 items-center justify-center">
									<span
										class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
									></span>
								</span>
							{:else}
								<Download size={18} />
							{/if}
						</button>

						<!-- Duration -->
						<div class="flex w-16 items-center justify-end gap-1 text-sm text-gray-400">
							<Clock size={14} />
							{losslessAPI.formatDuration(track.duration)}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
