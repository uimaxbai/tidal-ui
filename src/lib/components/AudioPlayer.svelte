<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { playerStore } from '$lib/stores/player';
	import { tidalAPI } from '$lib/api';
	import type { Track } from '$lib/types';
	import {
		Play,
		Pause,
		SkipForward,
		SkipBack,
		Volume2,
		VolumeX,
		Download
	} from 'lucide-svelte';

	let audioElement: HTMLAudioElement;
	let streamUrl = '';
	let isMuted = false;
	let previousVolume = 0.8;

	$: if ($playerStore.currentTrack && audioElement) {
		loadTrack($playerStore.currentTrack);
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
		try {
			playerStore.setLoading(true);
			
			// Get the track info from HIFI API
			// The manifest contains the actual TIDAL CDN URL which is CORS-friendly
			const trackInfo = await tidalAPI.getTrack(track.id, $playerStore.quality);
			
			// The HIFI API returns a base64 encoded manifest
			// We need to decode it to get the actual stream URL
			// For simplicity, we'll use the HIFI API endpoint which handles this
			streamUrl = await decodeManifestUrl(trackInfo.manifest);
			
			if (audioElement) {
				audioElement.load();
			}
			playerStore.setLoading(false);
		} catch (error) {
			console.error('Failed to load track:', error);
			playerStore.setLoading(false);
		}
	}

	/**
	 * Decode the BTS manifest to extract the stream URL
	 * The HIFI API returns TIDAL CDN URLs which are CORS-friendly
	 */
	async function decodeManifestUrl(manifest: string): Promise<string> {
		try {
			// Decode the base64 manifest
			const decoded = atob(manifest);
			
			// The manifest is in BTS (Binary Transport Stream) format
			// We need to parse it to extract the URL
			// For simplicity, we'll look for the URL pattern
			const urlMatch = decoded.match(/https?:\/\/[^\s<>"]+/);
			
			if (urlMatch) {
				return urlMatch[0];
			}
			
			// If we can't parse it, return empty and log error
			console.error('Could not parse manifest URL');
			return '';
		} catch (error) {
			console.error('Failed to decode manifest:', error);
			return '';
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

	async function handleDownload() {
		if (!$playerStore.currentTrack) return;
		
		try {
			const track = $playerStore.currentTrack;
			const filename = `${track.artist.name} - ${track.title}.flac`;
			await tidalAPI.downloadTrack(track.id, $playerStore.quality, filename);
		} catch (error) {
			console.error('Failed to download track:', error);
			alert('Failed to download track. Please try again.');
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
	<div class="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-50">
		<div class="max-w-screen-2xl mx-auto px-4 py-3">
			<!-- Progress Bar -->
			<div class="mb-3">
				<button
					onclick={handleSeek}
					class="w-full h-1 bg-gray-700 rounded-full cursor-pointer relative group"
					type="button"
					aria-label="Seek position"
				>
					<div
						class="h-full bg-blue-500 rounded-full transition-all"
						style="width: {($playerStore.currentTime / $playerStore.duration) * 100}%"
					></div>
					<div
						class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
						style="left: {($playerStore.currentTime / $playerStore.duration) * 100}%"
					></div>
				</button>
				<div class="flex justify-between text-xs text-gray-400 mt-1">
					<span>{formatTime($playerStore.currentTime)}</span>
					<span>{formatTime($playerStore.duration)}</span>
				</div>
			</div>

			<div class="flex items-center justify-between gap-4">
				<!-- Track Info -->
				<div class="flex items-center gap-3 flex-1 min-w-0">
					{#if $playerStore.currentTrack.album.cover}
						<img
							src={tidalAPI.getCoverUrl($playerStore.currentTrack.album.cover, '80')}
							alt={$playerStore.currentTrack.title}
							class="w-14 h-14 rounded shadow-lg object-cover"
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<h3 class="font-semibold text-white truncate">
							{$playerStore.currentTrack.title}
						</h3>
						<p class="text-sm text-gray-400 truncate">
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
						class="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
						disabled={$playerStore.queueIndex <= 0}
						aria-label="Previous track"
					>
						<SkipBack size={20} />
					</button>

					<button
						onclick={() => playerStore.togglePlay()}
						class="p-3 bg-white text-gray-900 rounded-full hover:scale-105 transition-transform"
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
						class="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
						disabled={$playerStore.queueIndex >= $playerStore.queue.length - 1}
						aria-label="Next track"
					>
						<SkipForward size={20} />
					</button>

					<button
						onclick={handleDownload}
						class="p-2 text-gray-400 hover:text-white transition-colors ml-2"
						aria-label="Download track"
						title="Download track"
					>
						<Download size={20} />
					</button>
				</div>

				<!-- Volume Control -->
				<div class="flex items-center gap-2">
					<button
						onclick={toggleMute}
						class="p-2 text-gray-400 hover:text-white transition-colors"
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
						class="w-24 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-white"
						aria-label="Volume"
					/>
				</div>
			</div>

			{#if $playerStore.isLoading}
				<div class="absolute inset-0 bg-gray-900/50 flex items-center justify-center">
					<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
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
