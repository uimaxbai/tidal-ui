<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import type { Track } from '$lib/types';
	import { onMount } from 'svelte';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { buildTrackFilename } from '$lib/downloads';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { LoaderCircle, Play, ArrowLeft, Disc, User, Clock, Download, X, Check } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils';

	let track = $state<Track | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloading = $state(false);
	let downloadTaskId = $state<string | null>(null);
	let isCancelled = $state(false);

	const trackId = $derived($page.params.id);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoverSeperatelyPreference = $derived($userPreferencesStore.downloadCoversSeperately);

	onMount(async () => {
		if (trackId) {
			await loadTrack(parseInt(trackId));
		}
	});

	async function loadTrack(id: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getTrack(id);
			track = data.track;
			
			// Automatically play the track if it's not already playing
			if (track) {
				const current = $playerStore.currentTrack;
				if (!current || current.id !== track.id) {
					playerStore.setQueue([track], 0);
					playerStore.play();
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load track';
			console.error('Failed to load track:', err);
		} finally {
			isLoading = false;
		}
	}

	function formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function markCancelled() {
		isCancelled = true;
		setTimeout(() => {
			isCancelled = false;
		}, 1500);
	}

	function handleCancelDownload() {
		if (downloadTaskId) {
			downloadUiStore.cancelTrackDownload(downloadTaskId);
		}
		isDownloading = false;
		downloadTaskId = null;
		markCancelled();
	}

	async function handleDownload() {
		if (!track) return;
		
		isDownloading = true;
		const quality = $playerStore.quality;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3Preference
		);

		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: track.album?.title ?? track.artist?.name
		});
		downloadTaskId = taskId;
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
				markCancelled();
			} else {
				console.error('Failed to download track:', error);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = error instanceof Error ? error.message : fallbackMessage;
				downloadUiStore.failTrackDownload(taskId, message);
			}
		} finally {
			isDownloading = false;
			downloadTaskId = null;
		}
	}
</script>

<svelte:head>
	<title>{track ? `${track.title} - ${formatArtists(track.artists)}` : 'Track'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<LoaderCircle class="h-16 w-16 animate-spin text-blue-500" />
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Track</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if track}
	<div class="track-page">
		<!-- Back Button -->
		<button
			onclick={() => {
				if (window.history.state && window.history.state.idx > 0) {
					window.history.back();
				} else {
					goto('/');
				}
			}}
			class="back-btn"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<div class="track-layout">
			<!-- Album Art -->
			<div class="album-art-wrapper">
				{#if track.album.cover}
					<img
						src={losslessAPI.getCoverUrl(track.album.cover, '1280')}
						alt={track.album.title}
						class="album-art"
					/>
				{:else}
					<div class="album-art-placeholder">
						<Disc size={64} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Track Info -->
			<div class="track-info">
				<h1 class="track-title">{track.title}</h1>
				{#if track.version}
					<span class="track-version">{track.version}</span>
				{/if}

				<div class="track-meta">
					<div class="meta-item meta-item--artist">
						<User size={20} />
						<a href={`/artist/${track.artist.id}`} class="meta-link">
							{formatArtists(track.artists)}
						</a>
					</div>
					<div class="meta-item">
						<Disc size={20} />
						<a href={`/album/${track.album.id}`} class="meta-link">
							{track.album.title}
						</a>
					</div>
					<div class="meta-item meta-item--muted">
						<Clock size={18} />
						<span>{formatDuration(track.duration)}</span>
					</div>
				</div>

				<div class="action-buttons">
					<button
						onclick={() => {
							if (track) {
								playerStore.setQueue([track], 0);
								playerStore.play();
							}
						}}
						class="btn btn--primary"
					>
						<Play size={20} fill="currentColor" />
						Play
					</button>

					{#if isDownloading}
						<button
							onclick={handleCancelDownload}
							class="btn btn--danger"
						>
							<X size={20} />
							Cancel
						</button>
					{:else if isCancelled}
						<button
							disabled
							class="btn btn--disabled"
						>
							<X size={20} />
							Cancelled
						</button>
					{:else}
						<button
							onclick={handleDownload}
							class="btn btn--secondary"
						>
							<Download size={20} />
							Download
						</button>
					{/if}

					<ShareButton type="track" id={track.id} variant="secondary" />
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.track-page {
		max-width: 56rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-8, 2rem);
		padding: var(--space-8, 2rem) 0;
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		color: rgba(148, 163, 184, 0.8);
		font-size: 0.875rem;
		font-weight: 500;
		background: none;
		border: none;
		padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
		margin-left: calc(-1 * var(--space-3, 0.75rem));
		border-radius: var(--radius-lg, 0.75rem);
		transition: color var(--transition-fast, 150ms ease), background var(--transition-fast, 150ms ease);
	}

	.back-btn:hover {
		color: #f8fafc;
		background: rgba(148, 163, 184, 0.1);
	}

	.track-layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-8, 2rem);
	}

	@media (min-width: 768px) {
		.track-layout {
			flex-direction: row;
		}
	}

	.album-art-wrapper {
		flex-shrink: 0;
		width: 100%;
		max-width: 24rem;
		aspect-ratio: 1;
		border-radius: var(--radius-xl, 1rem);
		overflow: hidden;
		box-shadow: 
			0 25px 80px rgba(0, 0, 0, 0.4),
			0 10px 30px rgba(0, 0, 0, 0.3);
		transition: transform var(--transition-slow, 300ms ease), box-shadow var(--transition-slow, 300ms ease);
	}

	.album-art-wrapper:hover {
		transform: scale(1.02) translateY(-4px);
		box-shadow: 
			0 35px 100px rgba(0, 0, 0, 0.5),
			0 15px 40px rgba(0, 0, 0, 0.35),
			0 0 60px rgba(59, 130, 246, 0.1);
	}

	.album-art {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.album-art-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(30, 41, 59, 0.8);
	}

	.track-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.track-title {
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 700;
		line-height: 1.1;
		margin: 0 0 var(--space-2, 0.5rem);
		background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.track-version {
		display: inline-block;
		font-size: 0.8rem;
		font-weight: 500;
		padding: var(--space-1, 0.25rem) var(--space-3, 0.75rem);
		margin-bottom: var(--space-4, 1rem);
		border-radius: var(--radius-md, 0.5rem);
		background: rgba(99, 102, 241, 0.15);
		border: 1px solid rgba(99, 102, 241, 0.25);
		color: rgba(196, 181, 253, 0.9);
	}

	.track-meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 0.75rem);
		margin-bottom: var(--space-6, 1.5rem);
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		color: rgba(148, 163, 184, 0.9);
	}

	.meta-item--artist {
		font-size: 1.25rem;
		color: rgba(203, 213, 225, 0.95);
	}

	.meta-item--muted {
		color: rgba(100, 116, 139, 0.9);
	}

	.meta-link {
		color: inherit;
		text-decoration: none;
		transition: color var(--transition-fast, 150ms ease);
	}

	.meta-link:hover {
		color: #60a5fa;
		text-decoration: underline;
	}

	.action-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3, 0.75rem);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
		font-size: 0.9rem;
		font-weight: 600;
		border-radius: var(--radius-full, 9999px);
		border: none;
		cursor: pointer;
		transition: 
			transform var(--transition-fast, 150ms ease),
			box-shadow var(--transition-base, 200ms ease),
			background var(--transition-base, 200ms ease);
	}

	.btn:hover {
		transform: translateY(-2px);
	}

	.btn--primary {
		background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
		color: white;
		box-shadow: 0 4px 15px rgba(59, 130, 246, 0.35);
	}

	.btn--primary:hover {
		box-shadow: 0 8px 25px rgba(59, 130, 246, 0.45);
	}

	.btn--secondary {
		background: rgba(30, 41, 59, 0.8);
		border: 1px solid rgba(148, 163, 184, 0.2);
		color: rgba(226, 232, 240, 0.95);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.btn--secondary:hover {
		background: rgba(51, 65, 85, 0.9);
		border-color: rgba(148, 163, 184, 0.3);
		box-shadow: 0 8px 25px rgba(0, 0, 0, 0.25);
	}

	.btn--danger {
		background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
		color: white;
		box-shadow: 0 4px 15px rgba(239, 68, 68, 0.35);
	}

	.btn--danger:hover {
		box-shadow: 0 8px 25px rgba(239, 68, 68, 0.45);
	}

	.btn--disabled {
		background: rgba(71, 85, 105, 0.6);
		color: rgba(148, 163, 184, 0.7);
		cursor: not-allowed;
	}

	.btn--disabled:hover {
		transform: none;
	}

	/* Mobile adjustments */
	@media (max-width: 767px) {
		.album-art-wrapper {
			max-width: 100%;
			margin: 0 auto;
		}

		.action-buttons {
			justify-content: center;
		}
	}
</style>

