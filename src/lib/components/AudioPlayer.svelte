<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { slide } from 'svelte/transition';
	import { playerStore } from '$lib/stores/player';
	import { lyricsStore } from '$lib/stores/lyrics';
	import { downloadsStore, activeDownloads, shouldShowFFmpegBanner } from '$lib/stores/downloads';
	import { cancelFFmpegCountdown } from '$lib/ffmpegClient';
	import { losslessAPI } from '$lib/api';
	import { getProxiedUrl } from '$lib/config';
	import type { Track, AudioQuality } from '$lib/types';
	import {
		Play,
		Pause,
		SkipForward,
		SkipBack,
		Volume2,
		VolumeX,
		ListMusic,
		Trash2,
		X,
		Shuffle,
		ScrollText,
		Loader2
	} from 'lucide-svelte';

	let audioElement: HTMLAudioElement;
	let streamUrl = $state('');
	let isMuted = $state(false);
	let previousVolume = 0.8;
	let currentTrackId: number | null = null;
	let loadSequence = 0;
	let bufferedPercent = $state(0);
	const { onHeightChange = () => {} } = $props<{ onHeightChange?: (height: number) => void }>();

	let containerElement: HTMLDivElement | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let showQueuePanel = $state(false);
	const streamCache = new Map<string, string>();
	let preloadingCacheKey: string | null = null;
	const PRELOAD_THRESHOLD_SECONDS = 12;

	const canUseMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
	let mediaSessionTrackId: number | null = null;
	let cleanupMediaSessionHandlers: (() => void) | null = null;
	let lastKnownPlaybackState: 'none' | 'paused' | 'playing' = 'none';

	function getCacheKey(trackId: number, quality: AudioQuality) {
		return `${trackId}:${quality}`;
	}

	async function resolveStream(track: Track): Promise<string> {
		const quality = $playerStore.quality;
		const cacheKey = getCacheKey(track.id, quality);
		const cached = streamCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const rawUrl = await losslessAPI.getStreamUrl(track.id, quality);
		const proxied = getProxiedUrl(rawUrl);
		streamCache.set(cacheKey, proxied);
		return proxied;
	}

	function pruneStreamCache() {
		const quality = $playerStore.quality;
		const keepKeys = new Set<string>();
		const current = $playerStore.currentTrack;
		if (current) {
			keepKeys.add(getCacheKey(current.id, quality));
		}
		const { queue, queueIndex } = $playerStore;
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack) {
			keepKeys.add(getCacheKey(nextTrack.id, quality));
		}

		for (const key of streamCache.keys()) {
			if (!keepKeys.has(key)) {
				streamCache.delete(key);
			}
		}
	}

	async function preloadNextTrack(track: Track) {
		const quality = $playerStore.quality;
		const cacheKey = getCacheKey(track.id, quality);
		if (streamCache.has(cacheKey) || preloadingCacheKey === cacheKey) {
			return;
		}

		preloadingCacheKey = cacheKey;
		try {
			await resolveStream(track);
			pruneStreamCache();
		} catch (error) {
			console.warn('Failed to preload next track:', error);
		} finally {
			if (preloadingCacheKey === cacheKey) {
				preloadingCacheKey = null;
			}
		}
	}

	function maybePreloadNextTrack(remainingSeconds: number) {
		if (remainingSeconds > PRELOAD_THRESHOLD_SECONDS) {
			return;
		}
		const { queue, queueIndex, quality } = $playerStore;
		const nextTrack = queue[queueIndex + 1];
		if (!nextTrack) {
			return;
		}
		const cacheKey = getCacheKey(nextTrack.id, quality);
		if (streamCache.has(cacheKey) || preloadingCacheKey === cacheKey) {
			return;
		}
		preloadNextTrack(nextTrack);
	}

	$effect(() => {
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
	});

	$effect(() => {
		if (showQueuePanel && $playerStore.queue.length === 0) {
			showQueuePanel = false;
		}
	});

	$effect(() => {
		if (canUseMediaSession) {
			updateMediaSessionMetadata($playerStore.currentTrack);
		}
	});

	$effect(() => {
		if (canUseMediaSession) {
			const hasTrack = Boolean($playerStore.currentTrack);
			updateMediaSessionPlaybackState(
				hasTrack ? ($playerStore.isPlaying ? 'playing' : 'paused') : 'none'
			);
		}
	});

	function toggleQueuePanel() {
		showQueuePanel = !showQueuePanel;
	}

	function closeQueuePanel() {
		showQueuePanel = false;
	}

	function playFromQueue(index: number) {
		playerStore.playAtIndex(index);
	}

	function removeFromQueue(index: number, event?: MouseEvent) {
		if (event) {
			event.stopPropagation();
		}
		playerStore.removeFromQueue(index);
	}

	function clearQueue() {
		playerStore.clearQueue();
	}

	function handleShuffleQueue() {
		playerStore.shuffleQueue();
	}

	$effect(() => {
		if (audioElement) {
			audioElement.volume = $playerStore.volume;
		}
	});

	$effect(() => {
		if ($playerStore.isPlaying && audioElement) {
			audioElement.play().catch(console.error);
		} else if (!$playerStore.isPlaying && audioElement) {
			audioElement.pause();
		}
	});

	async function loadTrack(track: Track) {
		const sequence = ++loadSequence;
		playerStore.setLoading(true);
		bufferedPercent = 0;

		try {
			const resolvedUrl = await resolveStream(track);

			if (sequence !== loadSequence) {
				return;
			}

			streamUrl = resolvedUrl;
			pruneStreamCache();

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
			const remaining = ($playerStore.duration ?? 0) - audioElement.currentTime;
			maybePreloadNextTrack(remaining);
			updateMediaSessionPositionState();
		}
	}

	function handleDurationChange() {
		if (audioElement) {
			playerStore.setDuration(audioElement.duration);
			updateBufferedPercent();
			updateMediaSessionPositionState();
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
		updateMediaSessionPositionState();
	}

	function getPercent(current: number, total: number): number {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (current / total) * 100));
	}

	function handleEnded() {
		playerStore.next();
		updateMediaSessionPositionState();
	}

	function handleSeek(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const percent = (event.clientX - rect.left) / rect.width;
		const newTime = percent * $playerStore.duration;

		if (audioElement) {
			audioElement.currentTime = newTime;
			playerStore.setCurrentTime(newTime);
			updateMediaSessionPositionState();
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

	function getMediaSessionArtwork(track: Track): MediaImage[] {
		if (!track.album?.cover) {
			return [];
		}

		const sizes = ['80', '160', '320', '640', '1280'] as const;
		const artwork: MediaImage[] = [];

		for (const size of sizes) {
			const src = losslessAPI.getCoverUrl(track.album.cover, size);
			if (src) {
				artwork.push({
					src,
					sizes: `${size}x${size}`,
					type: 'image/jpeg'
				});
			}
		}

		return artwork;
	}

	function updateMediaSessionMetadata(track: Track | null) {
		if (!canUseMediaSession) {
			return;
		}

		if (!track) {
			mediaSessionTrackId = null;
			lastKnownPlaybackState = 'none';
			try {
				navigator.mediaSession.metadata = null;
				navigator.mediaSession.playbackState = 'none';
			} catch (error) {
				console.debug('Media Session reset failed', error);
			}
			return;
		}

		if (mediaSessionTrackId === track.id) {
			return;
		}

		mediaSessionTrackId = track.id;

		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: track.artist?.name ?? '',
				album: track.album?.title ?? '',
				artwork: getMediaSessionArtwork(track)
			});
		} catch (error) {
			console.debug('Unable to set Media Session metadata', error);
		}

		updateMediaSessionPositionState();
	}

	function updateMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none') {
		if (!canUseMediaSession) {
			return;
		}

		if (lastKnownPlaybackState === state) {
			return;
		}
		lastKnownPlaybackState = state;

		try {
			navigator.mediaSession.playbackState = state;
		} catch (error) {
			console.debug('Unable to set Media Session playback state', error);
		}
	}

	function updateMediaSessionPositionState() {
		if (
			!canUseMediaSession ||
			!audioElement ||
			typeof navigator.mediaSession.setPositionState !== 'function'
		) {
			return;
		}

		const durationFromAudio = audioElement.duration;
		const storeState = get(playerStore);
		const duration = Number.isFinite(durationFromAudio) ? durationFromAudio : storeState.duration;

		try {
			navigator.mediaSession.setPositionState({
				duration: Number.isFinite(duration) ? duration : 0,
				playbackRate: audioElement.playbackRate ?? 1,
				position: audioElement.currentTime
			});
		} catch (error) {
			console.debug('Unable to set Media Session position state', error);
		}
	}

	function registerMediaSessionHandlers() {
		if (!canUseMediaSession) {
			return;
		}

		const safeSetActionHandler = (
			action: MediaSessionAction,
			handler: MediaSessionActionHandler | null
		) => {
			try {
				navigator.mediaSession.setActionHandler(action, handler);
			} catch (error) {
				console.debug(`Media Session action ${action} unsupported`, error);
			}
		};

		safeSetActionHandler('play', async () => {
			playerStore.play();
			if (!audioElement) return;
			try {
				await audioElement.play();
			} catch (error) {
				console.debug('Media Session play failed', error);
			}
			updateMediaSessionPlaybackState('playing');
			updateMediaSessionPositionState();
		});

		safeSetActionHandler('pause', () => {
			playerStore.pause();
			audioElement?.pause();
			updateMediaSessionPlaybackState('paused');
			updateMediaSessionPositionState();
		});

		safeSetActionHandler('previoustrack', () => {
			playerStore.previous();
		});

		safeSetActionHandler('nexttrack', () => {
			playerStore.next();
		});

		const handleSeekDelta =
			(direction: 'forward' | 'backward') => (details: MediaSessionActionDetails) => {
				if (!audioElement) return;
				const offset = details.seekOffset ?? 10;
				const delta = direction === 'forward' ? offset : -offset;
				const tentative = audioElement.currentTime + delta;
				const duration = audioElement.duration;
				const bounded = Number.isFinite(duration)
					? Math.min(Math.max(0, tentative), Math.max(duration, 0))
					: Math.max(0, tentative);
				audioElement.currentTime = bounded;
				playerStore.setCurrentTime(bounded);
				updateMediaSessionPositionState();
			};

		safeSetActionHandler('seekforward', handleSeekDelta('forward'));
		safeSetActionHandler('seekbackward', handleSeekDelta('backward'));

		safeSetActionHandler('seekto', (details) => {
			if (!audioElement || details.seekTime === undefined) return;
			const nextTime = Math.max(0, details.seekTime);
			audioElement.currentTime = nextTime;
			playerStore.setCurrentTime(nextTime);
			updateMediaSessionPositionState();
		});

		safeSetActionHandler('stop', () => {
			playerStore.pause();
			if (audioElement) {
				audioElement.pause();
				audioElement.currentTime = 0;
			}
			playerStore.setCurrentTime(0);
			updateMediaSessionPlaybackState('paused');
			updateMediaSessionPositionState();
		});

		cleanupMediaSessionHandlers = () => {
			const actions: MediaSessionAction[] = [
				'play',
				'pause',
				'previoustrack',
				'nexttrack',
				'seekforward',
				'seekbackward',
				'seekto',
				'stop'
			];
			for (const action of actions) {
				safeSetActionHandler(action, null);
			}
			mediaSessionTrackId = null;
			lastKnownPlaybackState = 'none';
		};
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

		if (canUseMediaSession) {
			registerMediaSessionHandlers();
			const state = get(playerStore);
			updateMediaSessionMetadata(state.currentTrack);
			updateMediaSessionPlaybackState(
				state.currentTrack ? (state.isPlaying ? 'playing' : 'paused') : 'none'
			);
			updateMediaSessionPositionState();
		}

		return () => {
			resizeObserver?.disconnect();
			cleanupMediaSessionHandlers?.();
			cleanupMediaSessionHandlers = null;
			if (canUseMediaSession) {
				try {
					navigator.mediaSession.metadata = null;
					navigator.mediaSession.playbackState = 'none';
				} catch (error) {
					console.debug('Failed to clean up Media Session', error);
				}
			}
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
	class="audio-player-backdrop fixed inset-x-0 bottom-0 z-50 px-4 pt-16 pb-5 sm:px-6 sm:pt-16 sm:pb-6"
	bind:this={containerElement}
>
	<!-- Download Banners - Positioned above player -->
	<div class="mx-auto w-full max-w-screen-2xl space-y-2 mb-2">
		<!-- FFmpeg Download Banner -->
		{#if $shouldShowFFmpegBanner}
			<div
				class="rounded-xl border border-blue-800/50 bg-blue-950/90 p-3 shadow-lg backdrop-blur-sm"
			>
				<div class="flex items-center justify-between gap-3">
					<div class="flex min-w-0 flex-1 items-center gap-3">
						<Loader2 size={18} class="flex-shrink-0 animate-spin text-blue-400" />
						<div class="min-w-0 flex-1">
							{#if $downloadsStore.ffmpeg.status === 'countdown'}
								<p class="text-sm font-medium text-white">
									Downloading FFmpeg ({$downloadsStore.ffmpeg.sizeEstimateMB} MB) in {$downloadsStore
										.ffmpeg.countdown} seconds...
								</p>
							{:else if $downloadsStore.ffmpeg.status === 'loading'}
								<p class="text-sm font-medium text-white">Downloading FFmpeg...</p>
								<div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-blue-900/50">
									<div
										class="h-full bg-blue-500 transition-all duration-300"
										style="width: {$downloadsStore.ffmpeg.progress || 0}%"
									></div>
								</div>
							{/if}
						</div>
					</div>
					<button
						onclick={() => cancelFFmpegCountdown()}
						class="flex-shrink-0 rounded-full p-1 text-blue-300 transition-colors hover:bg-blue-900/50 hover:text-white"
						aria-label="Cancel FFmpeg download"
						type="button"
					>
						<X size={16} />
					</button>
				</div>
			</div>
		{/if}

		<!-- Track Download Banners -->
		{#each $activeDownloads as download (download.trackId)}
			<div
				class="rounded-xl border border-gray-700/50 bg-gray-900/90 p-3 shadow-lg backdrop-blur-sm"
			>
				<div class="flex items-center justify-between gap-3">
					<div class="flex min-w-0 flex-1 items-center gap-3">
						{#if download.track.album.cover}
							<img
								src={losslessAPI.getCoverUrl(download.track.album.cover, '80')}
								alt={download.track.title}
								class="h-10 w-10 flex-shrink-0 rounded object-cover"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-white">
								{download.track.title}
							</p>
							<p class="truncate text-xs text-gray-400">
								{download.track.artist.name}
							</p>
							<div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
								<div
									class="h-full bg-blue-500 transition-all duration-300"
									style="width: {download.progress}%"
								></div>
							</div>
							<p class="mt-1 text-xs text-gray-500">
								{#if download.status === 'pending'}
									Starting download...
								{:else if download.status === 'downloading'}
									Downloading... {download.progress}%
								{:else if download.status === 'processing'}
									Processing metadata... {download.progress}%
								{/if}
							</p>
						</div>
					</div>
					<button
						onclick={() => downloadsStore.cancelTrackDownload(download.trackId)}
						class="flex-shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-red-400"
						aria-label="Cancel download"
						type="button"
					>
						<X size={16} />
					</button>
				</div>
			</div>
		{/each}
	</div>

	<div
		class="mx-auto w-full max-w-screen-2xl overflow-hidden rounded-2xl border border-gray-800 bg-zinc-900 shadow-2xl"
	>
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

				<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
					<!-- Mobile: Two-line layout -->
					<!-- Desktop: Single-line layout -->
					
					<!-- Track Info (Mobile: Full width top line, Desktop: Left side) -->
					<div class="flex min-w-0 flex-1 items-center gap-3">
						{#if $playerStore.currentTrack.album.cover}
							<img
								src={losslessAPI.getCoverUrl($playerStore.currentTrack.album.cover, '640')}
								alt={$playerStore.currentTrack.title}
								class="h-14 w-14 flex-shrink-0 rounded object-cover shadow-lg"
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

					<!-- Mobile: Controls row at bottom -->
					<!-- Desktop: Inline with track info -->
					<div class="flex items-center justify-between gap-2 sm:justify-start">
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

						<!-- Queue & Lyrics Toggle (no lyrics for now) -->
						<div class="flex items-center gap-2">
							<!--
							<button
								onclick={() => lyricsStore.toggle()}
								class="flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-900/60 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-blue-500 hover:text-white {$lyricsStore.open
									? 'border-blue-500 text-white'
									: ''}"
								aria-label={$lyricsStore.open ? 'Hide lyrics popup' : 'Show lyrics popup'}
								aria-expanded={$lyricsStore.open}
								type="button"
							>
							<ScrollText size={18} />
							<span class="hidden sm:inline">Lyrics</span>
						</button>
						-->
						<button
							onclick={toggleQueuePanel}
							class="flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-900/60 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-blue-500 hover:text-white {showQueuePanel
								? 'border-blue-500 text-white'
								: ''}"
							aria-label="Toggle queue panel"
							aria-expanded={showQueuePanel}
							type="button"
						>
							<ListMusic size={18} />
							<span class="hidden sm:inline">Queue ({$playerStore.queue.length})</span>
						</button>
					</div>

					<!-- Volume Control (Desktop only visible) -->
					<div class="hidden items-center gap-2 sm:flex">
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
				</div>

				{#if showQueuePanel}
					<div
						transition:slide={{ duration: 300 }}
						class="mt-4 space-y-3 rounded-2xl border border-gray-800/80 bg-neutral-900/90 p-4 text-sm shadow-inner"
					>
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2 text-gray-300">
								<ListMusic size={18} />
								<span class="font-medium">Playback Queue</span>
								<span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
									{$playerStore.queue.length}
								</span>
							</div>
							<div class="flex items-center gap-2">
								<button
									onclick={handleShuffleQueue}
									class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-blue-500 hover:text-blue-200 disabled:opacity-40"
									type="button"
									disabled={$playerStore.queue.length <= 1}
								>
									<Shuffle size={14} />
									Shuffle
								</button>
								<button
									onclick={clearQueue}
									class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-red-500 hover:text-red-400"
									type="button"
									disabled={$playerStore.queue.length === 0}
								>
									<Trash2 size={14} />
									Clear
								</button>
								<button
									onclick={closeQueuePanel}
									class="rounded-full p-1 text-gray-400 transition-colors hover:text-white"
									aria-label="Close queue panel"
								>
									<X size={16} />
								</button>
							</div>
						</div>

						{#if $playerStore.queue.length > 0}
							<ul class="max-h-60 space-y-2 overflow-y-auto pr-1">
								{#each $playerStore.queue as queuedTrack, index}
									<li>
										<div
											onclick={() => playFromQueue(index)}
											onkeydown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													playFromQueue(index);
												}
											}}
											tabindex="0"
											role="button"
											class="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors {index ===
											$playerStore.queueIndex
												? 'bg-blue-500/10 text-white'
												: 'text-gray-200 hover:bg-gray-800/70'}"
										>
											<span
												class="w-6 text-xs font-semibold text-gray-500 group-hover:text-gray-300"
											>
												{index + 1}
											</span>
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium">
													{queuedTrack.title}
												</p>
												<p class="truncate text-xs text-gray-400 group-hover:text-gray-300">
													{queuedTrack.artist.name}
												</p>
											</div>
											<button
												onclick={(event) => removeFromQueue(index, event)}
												class="rounded-full p-1 text-gray-500 transition-colors hover:text-red-400"
												aria-label={`Remove ${queuedTrack.title} from queue`}
												type="button"
											>
												<X size={14} />
											</button>
										</div>
									</li>
								{/each}
							</ul>
						{:else}
							<p
								class="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 px-3 py-8 text-center text-gray-400"
							>
								Queue is empty
							</p>
						{/if}
					</div>
				{/if}

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
		mask: linear-gradient(to bottom, transparent 0%, black 25%);
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
