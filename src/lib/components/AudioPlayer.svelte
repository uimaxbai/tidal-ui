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
	let bufferedPercent = 0;
	export let onHeightChange: (height: number) => void = () => {};

	let containerElement: HTMLDivElement | null = null;
	let resizeObserver: ResizeObserver | null = null;

	$:{
		const current = $playerStore.currentTrack;
		if (!audioElement || !current) {
			if (!current) {
				currentTrackId = null;
				streamUrl = '';
				bufferedPercent = 0;
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
		bufferedPercent = 0;

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
			updateBufferedPercent();
		}
	}

	function handleDurationChange() {
		if (audioElement) {
			playerStore.setDuration(audioElement.duration);
			updateBufferedPercent();
		}
	}

	function updateBufferedPercent() {
		if (!audioElement) {
			bufferedPercent = 0;
			return;
		}

		const { duration, buffered, currentTime } = audioElement;
		if (!Number.isFinite(duration) || duration <= 0 || buffered.length === 0) {
			bufferedPercent = 0;
			return;
		}

		let bufferedEnd = 0;
		for (let i = 0; i < buffered.length; i += 1) {
			const start = buffered.start(i);
			const end = buffered.end(i);
			if (start <= currentTime && end >= currentTime) {
				bufferedEnd = end;
				break;
			}
			bufferedEnd = Math.max(bufferedEnd, end);
		}

		bufferedPercent = Math.max(0, Math.min(100, (bufferedEnd / duration) * 100));
	}

	function handleProgress() {
		updateBufferedPercent();
	}

	function handleLoadedData() {
		playerStore.setLoading(false);
		updateBufferedPercent();
	}

	function getPercent(current: number, total: number): number {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (current / total) * 100));
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

	function formatQualityLabel(quality?: string): string {
		if (!quality) return '—';
		if (quality.toUpperCase() === 'LOSSLESS') {
			return 'CD';
		}
		return quality;
	}

	onMount(() => {
		if (audioElement) {
			audioElement.volume = $playerStore.volume;
		}

		if (containerElement) {
			notifyContainerHeight();
			resizeObserver = new ResizeObserver(() => {
				notifyContainerHeight();
			});
			resizeObserver.observe(containerElement);
		}

		return () => {
			resizeObserver?.disconnect();
		};
	});

	function notifyContainerHeight() {
		if (typeof onHeightChange === 'function' && containerElement) {
			onHeightChange(containerElement.offsetHeight ?? 0);
		}
	}
</script>

<audio
	bind:this={audioElement}
	src={streamUrl}
	ontimeupdate={handleTimeUpdate}
	ondurationchange={handleDurationChange}
	onended={handleEnded}
	onloadeddata={handleLoadedData}
	onloadedmetadata={updateBufferedPercent}
	onprogress={handleProgress}
	class="hidden"
></audio>

<div
	class="audio-player-backdrop fixed inset-x-0 bottom-0 z-50 px-4 pb-5 pt-6 sm:px-6 sm:pb-6 sm:pt-8"
	bind:this={containerElement}
>
	<div class="mx-auto w-full max-w-screen-2xl overflow-hidden rounded-2xl border border-gray-800 bg-zinc-900 shadow-2xl">
		<div class="relative px-4 py-3">
			{#if $playerStore.currentTrack}
				<!-- Progress Bar -->
				<div class="mb-3">
					<button
						onclick={handleSeek}
						class="group relative h-1 w-full cursor-pointer overflow-hidden rounded-full bg-gray-700"
						type="button"
						aria-label="Seek position"
					>
						<div
							class="pointer-events-none absolute inset-y-0 left-0 bg-blue-400/30 transition-all"
							style="width: {bufferedPercent}%"
							aria-hidden="true"
						></div>
						<div
							class="pointer-events-none absolute inset-y-0 left-0 bg-blue-500 transition-all"
							style="width: {getPercent($playerStore.currentTime, $playerStore.duration)}%"
							aria-hidden="true"
						></div>
						<div
							class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100"
							style="left: {getPercent($playerStore.currentTime, $playerStore.duration)}%"
							aria-hidden="true"
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
								{formatQualityLabel($playerStore.currentTrack.audioQuality)}
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
							class="hidden h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-white sm:block"
							aria-label="Volume"
						/>
					</div>
				</div>

				{#if $playerStore.currentTrack && $playerStore.isLoading}
					<div class="loading-overlay">
						<div class="loading-equalizer" aria-hidden="true">
							<span class="bar" style="animation-delay: 0ms"></span>
							<span class="bar" style="animation-delay: 150ms"></span>
							<span class="bar" style="animation-delay: 300ms"></span>
							<span class="bar" style="animation-delay: 450ms"></span>
						</div>
						<p class="text-sm font-medium text-gray-200">Loading track…</p>
					</div>
				{/if}
			{:else}
				<div class="flex h-20 items-center justify-center text-sm text-gray-400">
					Nothing is playing
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.audio-player-backdrop {
		isolation: isolate;
	}

	.audio-player-backdrop::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		mask: linear-gradient(
			to bottom,
			transparent, black, black
		);
	}

	.audio-player-backdrop > * {
		position: relative;
		z-index: 1;
	}

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

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background: rgba(17, 24, 39, 0.65);
		backdrop-filter: blur(6px);
	}

	.loading-equalizer {
		display: flex;
		align-items: flex-end;
		gap: 0.4rem;
		height: 1.75rem;
	}

	.loading-equalizer .bar {
		width: 0.3rem;
		height: 0.6rem;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.85);
		animation: equalize 1s ease-in-out infinite;
	}

	@keyframes equalize {
		0% {
			opacity: 0.4;
			height: 0.5rem;
		}
		40% {
			opacity: 1;
			height: 1.7rem;
		}
		80% {
			opacity: 0.6;
			height: 0.8rem;
		}
		100% {
			opacity: 0.4;
			height: 0.5rem;
		}
	}
</style>
