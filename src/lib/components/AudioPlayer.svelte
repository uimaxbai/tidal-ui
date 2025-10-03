<script lang="ts">
	import { onMount } from 'svelte';
	import { playerStore } from '$lib/stores/player';
	import { tidalAPI } from '$lib/api';
	import { getProxiedUrl } from '$lib/config';
	import type { Track } from '$lib/types';
	import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX } from 'lucide-svelte';

	let audioElement: HTMLAudioElement;
	let streamUrl = '';
	let isMuted = false;
	let previousVolume = 0.8;
	let currentTrackId: number | null = null;
	let loadSequence = 0;

	$:{
		const current = $playerStore.currentTrack;
		if (!audioElement || !current) {
			if (!current) {
				currentTrackId = null;
				streamUrl = '';
			}
		} else if (current.id !== currentTrackId) {
			currentTrackId = current.id;
			streamUrl = '';
			loadTrack(current);
		}
	}

	$: if (audioElement) {
		audioElement.volume = $playerStore.volume;
	}

	$: if ($playerStore.isPlaying && audioElement) {
		audioElement.play().catch(console.error);
	} else if (!$playerStore.isPlaying && audioElement) {
		audioElement.pause();
	}

	async function loadTrack(track: Track) {
		const sequence = ++loadSequence;
		playerStore.setLoading(true);

		try {
			const resolvedUrl = await tidalAPI.getStreamUrl(track.id, $playerStore.quality);

			if (sequence !== loadSequence) {
				return;
			}

			streamUrl = getProxiedUrl(resolvedUrl);

			if (audioElement) {
				audioElement.crossOrigin = 'anonymous';
				audioElement.load();
			}
		} catch (error) {
			console.error('Failed to load track:', error);
		} finally {
			if (sequence === loadSequence) {
				playerStore.setLoading(false);
			}
		}
	}

	function handleTimeUpdate() {
		if (audioElement) {
			playerStore.setCurrentTime(audioElement.currentTime);
		}
	}

	function handleDurationChange() {
		if (audioElement) {
			playerStore.setDuration(audioElement.duration);
		}
	}

	function handleEnded() {
		playerStore.next();
	}

	function handleSeek(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const percent = (event.clientX - rect.left) / rect.width;
		const newTime = percent * $playerStore.duration;

		if (audioElement) {
			audioElement.currentTime = newTime;
			playerStore.setCurrentTime(newTime);
		}
	}

	function handleVolumeChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const newVolume = parseFloat(target.value);
		playerStore.setVolume(newVolume);
		if (newVolume > 0 && isMuted) {
			isMuted = false;
		}
	}

	function toggleMute() {
		if (isMuted) {
			playerStore.setVolume(previousVolume);
			isMuted = false;
		} else {
			previousVolume = $playerStore.volume;
			playerStore.setVolume(0);
			isMuted = true;
		}
	}

	function formatTime(seconds: number): string {
		if (isNaN(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	onMount(() => {
		if (audioElement) {
			audioElement.volume = $playerStore.volume;
		}
	});
</script>

<audio
	bind:this={audioElement}
	src={streamUrl}
	ontimeupdate={handleTimeUpdate}
	ondurationchange={handleDurationChange}
	onended={handleEnded}
	onloadeddata={() => playerStore.setLoading(false)}
	class="hidden"
></audio>

{#if $playerStore.currentTrack}
	<div class="fixed right-0 bottom-0 left-0 z-50 border-t border-gray-800 bg-gray-900">
		<div class="mx-auto max-w-screen-2xl px-4 py-3">
			<!-- Progress Bar -->
			<div class="mb-3">
				<button
					onclick={handleSeek}
					class="group relative h-1 w-full cursor-pointer rounded-full bg-gray-700"
					type="button"
					aria-label="Seek position"
				>
					<div
						class="h-full rounded-full bg-blue-500 transition-all"
						style="width: {($playerStore.currentTime / $playerStore.duration) * 100}%"
					></div>
					<div
						class="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100"
						style="left: {($playerStore.currentTime / $playerStore.duration) * 100}%"
					></div>
				</button>
				<div class="mt-1 flex justify-between text-xs text-gray-400">
					<span>{formatTime($playerStore.currentTime)}</span>
					<span>{formatTime($playerStore.duration)}</span>
				</div>
			</div>

			<div class="flex items-center justify-between gap-4">
				<!-- Track Info -->
				<div class="flex min-w-0 flex-1 items-center gap-3">
					{#if $playerStore.currentTrack.album.cover}
						<img
							src={tidalAPI.getCoverUrl($playerStore.currentTrack.album.cover, '80')}
							alt={$playerStore.currentTrack.title}
							class="h-14 w-14 rounded object-cover shadow-lg"
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<h3 class="truncate font-semibold text-white">
							{$playerStore.currentTrack.title}
						</h3>
						<p class="truncate text-sm text-gray-400">
							{$playerStore.currentTrack.artist.name}
						</p>
						<p class="text-xs text-gray-500">
							{$playerStore.currentTrack.audioQuality}
						</p>
					</div>
				</div>

				<!-- Controls -->
				<div class="flex items-center gap-2">
					<button
						onclick={() => playerStore.previous()}
						class="p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
						disabled={$playerStore.queueIndex <= 0}
						aria-label="Previous track"
					>
						<SkipBack size={20} />
					</button>

					<button
						onclick={() => playerStore.togglePlay()}
						class="rounded-full bg-white p-3 text-gray-900 transition-transform hover:scale-105"
						aria-label={$playerStore.isPlaying ? 'Pause' : 'Play'}
					>
						{#if $playerStore.isPlaying}
							<Pause size={24} fill="currentColor" />
						{:else}
							<Play size={24} fill="currentColor" />
						{/if}
					</button>

					<button
						onclick={() => playerStore.next()}
						class="p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
						disabled={$playerStore.queueIndex >= $playerStore.queue.length - 1}
						aria-label="Next track"
					>
						<SkipForward size={20} />
					</button>

				</div>

				<!-- Volume Control -->
				<div class="flex items-center gap-2">
					<button
						onclick={toggleMute}
						class="p-2 text-gray-400 transition-colors hover:text-white"
						aria-label={isMuted ? 'Unmute' : 'Mute'}
					>
						{#if isMuted || $playerStore.volume === 0}
							<VolumeX size={20} />
						{:else}
							<Volume2 size={20} />
						{/if}
					</button>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={$playerStore.volume}
						oninput={handleVolumeChange}
						class="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-white"
						aria-label="Volume"
					/>
				</div>
			</div>

			{#if $playerStore.isLoading}
				<div class="absolute inset-0 flex items-center justify-center bg-gray-900/50">
					<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		cursor: pointer;
	}

	input[type='range']::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}
</style>
