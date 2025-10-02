<script lang="ts">
	import type { Track } from '$lib/types';
	import { tidalAPI } from '$lib/api';
	import { playerStore } from '$lib/stores/player';
	import { Play, Pause, Download, Clock } from 'lucide-svelte';

	interface Props {
		tracks: Track[];
		showAlbum?: boolean;
		showArtist?: boolean;
		showCover?: boolean;
	}

	let { tracks, showAlbum = true, showArtist = true, showCover = true }: Props = $props();

	function handlePlayTrack(track: Track, index: number) {
		playerStore.setQueue(tracks, index);
		playerStore.play();
	}

	async function handleDownload(track: Track, event: MouseEvent) {
		event.stopPropagation();
		
		try {
			const filename = `${track.artist.name} - ${track.title}.flac`;
			await tidalAPI.downloadTrack(track.id, $playerStore.quality, filename);
		} catch (error) {
			console.error('Failed to download track:', error);
			alert('Failed to download track. Please try again.');
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
		<div class="text-center py-12 text-gray-400">
			<p>No tracks available</p>
		</div>
	{:else}
		<div class="space-y-1">
			{#each tracks as track, index}
				<div
					class="w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left group {isCurrentTrack(
						track
					)
						? 'bg-blue-900/20'
						: 'hover:bg-gray-800'}"
				>
					<!-- Track Number / Play Button -->
					<button
						onclick={() => handlePlayTrack(track, index)}
						class="w-8 flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform"
						aria-label={isPlaying(track) ? 'Pause' : 'Play'}
					>
						{#if isPlaying(track)}
							<Pause size={16} class="text-blue-500" />
						{:else if isCurrentTrack(track)}
							<Play size={16} class="text-blue-500" />
						{:else}
							<span class="text-gray-400 text-sm group-hover:hidden">{index + 1}</span>
							<Play size={16} class="text-white hidden group-hover:block" />
						{/if}
					</button>

					<!-- Cover -->
					{#if showCover && track.album.cover}
						<img
							src={tidalAPI.getCoverUrl(track.album.cover, '80')}
							alt={track.title}
							class="w-12 h-12 rounded object-cover flex-shrink-0"
						/>
					{/if}

					<!-- Track Info -->
					<div class="flex-1 min-w-0">
						<h3
							class="font-medium truncate {isCurrentTrack(track)
								? 'text-blue-500'
								: 'text-white group-hover:text-blue-400'}"
						>
							{track.title}
							{#if track.explicit}
								<span class="text-xs text-gray-500 ml-1">[E]</span>
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
						<div class="text-xs text-gray-500 mt-0.5">
							{track.audioQuality}
							{#if track.mediaMetadata?.tags && track.mediaMetadata.tags.length > 0}
								• {track.mediaMetadata.tags.join(', ')}
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="flex items-center gap-2 flex-shrink-0">
						<button
							onclick={(e) => handleDownload(track, e)}
							class="p-2 text-gray-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
							aria-label="Download track"
							title="Download track"
						>
							<Download size={18} />
						</button>

						<!-- Duration -->
						<div class="flex items-center gap-1 text-gray-400 text-sm w-16 justify-end">
							<Clock size={14} />
							{tidalAPI.formatDuration(track.duration)}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

