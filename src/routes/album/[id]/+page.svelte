<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import type { Album, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import {
		ArrowLeft,
		Play,
		Calendar,
		Disc,
		Clock,
		Download,
		Shuffle,
		LoaderCircle
	} from 'lucide-svelte';
	import { playerStore } from '$lib/stores/player';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { downloadAlbum } from '$lib/downloads';

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);
	let downloadError = $state<string | null>(null);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);

	const albumId = $derived($page.params.id);

	onMount(async () => {
		if (albumId) {
			await loadAlbum(parseInt(albumId));
		}
	});

	async function loadAlbum(id: number) {
		try {
			isLoading = true;
			error = null;
			const { album: albumData, tracks: albumTracks } = await losslessAPI.getAlbum(id);
			album = albumData;
			tracks = albumTracks;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load album';
			console.error('Failed to load album:', err);
		} finally {
			isLoading = false;
		}
	}

	function handlePlayAll() {
		if (tracks.length > 0) {
			playerStore.setQueue(tracks, 0);
			playerStore.play();
		}
	}

	function shuffleTracks(list: Track[]): Track[] {
		const items = list.slice();
		for (let i = items.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[items[i], items[j]] = [items[j]!, items[i]!];
		}
		return items;
	}

	function handleShufflePlay() {
		if (tracks.length === 0) return;
		const shuffled = shuffleTracks(tracks);
		playerStore.setQueue(shuffled, 0);
		playerStore.play();
	}

	async function handleDownloadAll() {
		if (!album || tracks.length === 0 || isDownloadingAll) {
			return;
		}

		isDownloadingAll = true;
		downloadedCount = 0;
		downloadError = null;
		const quality = $userPreferencesStore.playbackQuality;
		const mode = albumDownloadMode;

		try {
			let failedCount = 0;
			await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: () => {
						downloadedCount = 0;
					},
					onTrackDownloaded: (completed) => {
						downloadedCount = completed;
					},
					onTrackFailed: (track, error, attempt) => {
						if (attempt >= 3) {
							failedCount++;
						}
					}
				},
				album.artist?.name,
				{ mode, convertAacToMp3: convertAacToMp3Preference }
			);
			
			if (failedCount > 0) {
				downloadError = `Download completed. ${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts.`;
			}
		} catch (err) {
			console.error('Failed to download album:', err);
			downloadError =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download one or more tracks.';
		} finally {
			isDownloadingAll = false;
		}
	}

	const totalDuration = $derived(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0));
</script>

<svelte:head>
	<title>{album?.title || 'Album'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<LoaderCircle size={16} class="h-16 w-16 animate-spin text-blue-500" />
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Album</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if album}
	<div class="album-page">
		<!-- Back Button -->
		<button
			onclick={() => window.history.back()}
			class="w-fit flex items-center gap-2 rounded-lg px-3 py-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Album Header -->
		<div class="album-header">
			<!-- Album Cover -->
			{#if album.videoCover || album.cover}
				<div class="album-cover-wrapper">
					{#if album.videoCover}
						<video
							src={losslessAPI.getVideoCoverUrl(album.videoCover, '640')}
							poster={album.cover ? losslessAPI.getCoverUrl(album.cover, '640') : undefined}
							aria-label={album.title}
							class="album-cover"
							autoplay
							loop
							muted
							playsinline
							preload="metadata"
						></video>
					{:else}
						<img
							src={losslessAPI.getCoverUrl(album.cover!, '640')}
							alt={album.title}
							class="album-cover"
						/>
					{/if}
				</div>
			{/if}

			<!-- Album Info -->
			<div class="album-info">
				<span class="album-type">ALBUM</span>
				<h1 class="album-title">{album.title}</h1>
				<div class="album-artist-row">
					{#if album.explicit}
						<svg
							class="explicit-badge"
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
					{#if album.artist}
						<a
							href={`/artist/${album.artist.id}`}
							data-sveltekit-preload-data
							class="artist-link"
						>
							{album.artist.name}
						</a>
					{/if}
				</div>

				<div class="album-meta">
					{#if album.releaseDate}
						<div class="meta-badge">
							<Calendar size={16} />
							{new Date(album.releaseDate).getFullYear()}
						</div>
					{/if}
					{#if tracks.length > 0 || album.numberOfTracks}
						<div class="meta-badge">
							<Disc size={16} />
							{tracks.length || album.numberOfTracks} tracks
						</div>
					{/if}
					{#if totalDuration > 0}
						<div class="meta-badge">
							<Clock size={16} />
							{losslessAPI.formatDuration(totalDuration)} total
						</div>
					{/if}
					{#if album.mediaMetadata?.tags}
						{#each album.mediaMetadata.tags as tag}
							<span class="tag-badge">{tag}</span>
						{/each}
					{/if}
				</div>

				{#if tracks.length > 0}
					<div class="action-buttons">
						<button
							onclick={handlePlayAll}
							class="btn btn--primary"
						>
							<Play size={20} fill="currentColor" />
							Play All
						</button>
						<button
							onclick={handleShufflePlay}
							class="btn btn--accent"
						>
							<Shuffle size={18} />
							Shuffle Play
						</button>
						<button
							onclick={handleDownloadAll}
							class="btn btn--secondary"
							disabled={isDownloadingAll}
						>
							<Download size={18} />
							{isDownloadingAll
								? `Downloading ${downloadedCount}/${tracks.length}`
								: 'Download All'}
						</button>
						<ShareButton type="album" id={album.id} variant="secondary" />
					</div>
					{#if downloadError}
						<p class="download-error">{downloadError}</p>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Tracks -->
		<div class="tracks-section">
			<h2 class="section-title">Tracks</h2>
			<TrackList {tracks} showAlbum={false} />
			{#if tracks.length === 0}
				<div class="warning-box">
					<p>
						We couldn't find tracks for this album. Try refreshing or searching for individual
						songs.
					</p>
				</div>
			{/if}
			{#if album.copyright}
				<p class="copyright">{album.copyright}</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.album-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-6, 1.5rem);
		padding-bottom: 8rem;
	}

	@media (min-width: 1024px) {
		.album-page {
			padding-bottom: 10rem;
		}
	}

	.album-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-8, 2rem);
	}

	@media (min-width: 768px) {
		.album-header {
			flex-direction: row;
		}
	}

	.album-cover-wrapper {
		flex-shrink: 0;
		width: 100%;
		max-width: 20rem;
		aspect-ratio: 1;
		border-radius: var(--radius-xl, 1rem);
		overflow: hidden;
		box-shadow: 
			0 25px 80px rgba(0, 0, 0, 0.4),
			0 10px 30px rgba(0, 0, 0, 0.3);
		transition: transform var(--transition-slow, 300ms ease), box-shadow var(--transition-slow, 300ms ease);
	}

	.album-cover-wrapper:hover {
		transform: scale(1.02) translateY(-4px);
		box-shadow: 
			0 35px 100px rgba(0, 0, 0, 0.5),
			0 15px 40px rgba(0, 0, 0, 0.35),
			0 0 60px rgba(59, 130, 246, 0.1);
	}

	.album-cover {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.album-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}

	.album-type {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: rgba(148, 163, 184, 0.7);
		margin-bottom: var(--space-2, 0.5rem);
	}

	.album-title {
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 700;
		line-height: 1.1;
		margin: 0 0 var(--space-4, 1rem);
		background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.album-artist-row {
		display: flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		margin-bottom: var(--space-4, 1rem);
	}

	.explicit-badge {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		color: rgba(148, 163, 184, 0.7);
	}

	.artist-link {
		font-size: 1.25rem;
		color: rgba(203, 213, 225, 0.95);
		text-decoration: none;
		transition: color var(--transition-fast, 150ms ease);
	}

	.artist-link:hover {
		color: #f8fafc;
		text-decoration: underline;
	}

	.album-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3, 0.75rem);
		margin-bottom: var(--space-6, 1.5rem);
	}

	.meta-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1, 0.25rem);
		font-size: 0.875rem;
		color: rgba(148, 163, 184, 0.8);
	}

	.tag-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem);
		border-radius: var(--radius-md, 0.5rem);
		background: rgba(59, 130, 246, 0.15);
		border: 1px solid rgba(59, 130, 246, 0.25);
		color: rgba(147, 197, 253, 0.95);
	}

	.action-buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3, 0.75rem);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2, 0.5rem);
		padding: var(--space-3, 0.75rem) var(--space-5, 1.25rem);
		font-size: 0.875rem;
		font-weight: 600;
		border-radius: var(--radius-full, 9999px);
		border: none;
		cursor: pointer;
		transition: 
			transform var(--transition-fast, 150ms ease),
			box-shadow var(--transition-base, 200ms ease),
			background var(--transition-base, 200ms ease),
			border-color var(--transition-base, 200ms ease);
	}

	.btn:hover:not(:disabled) {
		transform: translateY(-2px);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn--primary {
		background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
		color: white;
		box-shadow: 0 4px 15px rgba(59, 130, 246, 0.35);
	}

	.btn--primary:hover:not(:disabled) {
		box-shadow: 0 8px 25px rgba(59, 130, 246, 0.45);
	}

	.btn--accent {
		background: transparent;
		border: 1px solid rgba(167, 139, 250, 0.5);
		color: rgba(196, 181, 253, 0.95);
	}

	.btn--accent:hover:not(:disabled) {
		border-color: rgba(167, 139, 250, 0.7);
		color: rgba(221, 214, 254, 1);
		box-shadow: 0 0 20px rgba(139, 92, 246, 0.2);
	}

	.btn--secondary {
		background: transparent;
		border: 1px solid rgba(96, 165, 250, 0.4);
		color: rgba(147, 197, 253, 0.95);
	}

	.btn--secondary:hover:not(:disabled) {
		border-color: rgba(96, 165, 250, 0.6);
		color: rgba(191, 219, 254, 1);
		box-shadow: 0 0 20px rgba(59, 130, 246, 0.15);
	}

	.download-error {
		margin-top: var(--space-2, 0.5rem);
		font-size: 0.875rem;
		color: rgba(248, 113, 113, 0.9);
	}

	.tracks-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4, 1rem);
		margin-top: var(--space-4, 1rem);
	}

	.section-title {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		color: #f8fafc;
	}

	.warning-box {
		padding: var(--space-6, 1.5rem);
		border-radius: var(--radius-lg, 0.75rem);
		background: rgba(161, 98, 7, 0.15);
		border: 1px solid rgba(161, 98, 7, 0.3);
		color: rgba(253, 224, 71, 0.9);
	}

	.warning-box p {
		margin: 0;
	}

	.copyright {
		margin: var(--space-2, 0.5rem) 0 0;
		font-size: 0.75rem;
		color: rgba(100, 116, 139, 0.7);
	}

	/* Mobile adjustments */
	@media (max-width: 767px) {
		.album-cover-wrapper {
			max-width: 100%;
			margin: 0 auto;
		}

		.action-buttons {
			justify-content: center;
		}
	}
</style>

