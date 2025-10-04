<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import type { Album, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import { ArrowLeft, Play, Calendar, Disc, Clock, Download, Shuffle } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { playerStore } from '$lib/stores/player';

	let album = $state<Album | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isDownloadingAll = $state(false);
	let downloadedCount = $state(0);
	let downloadError = $state<string | null>(null);

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
		if (tracks.length === 0 || isDownloadingAll) {
			return;
		}

		isDownloadingAll = true;
		downloadedCount = 0;
		downloadError = null;
		const quality = $playerStore.quality;

		for (const track of tracks) {
			try {
				const filename = `${track.artist.name} - ${track.title}.flac`;
				await losslessAPI.downloadTrack(track.id, quality, filename);
				downloadedCount += 1;
			} catch (err) {
				console.error('Failed to download album track:', err);
				downloadError =
					err instanceof Error ? err.message : 'Failed to download one or more tracks.';
			}
		}

		isDownloadingAll = false;
	}

	const totalDuration = $derived(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0));
</script>

<svelte:head>
	<title>{album?.title || 'Album'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<div class="h-16 w-16 animate-spin rounded-full border-b-2 border-blue-500"></div>
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Album</h2>
			<p class="text-red-300">{error}</p>
			<button
				onclick={() => goto('/')}
				class="mt-4 rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</button>
		</div>
	</div>
{:else if album}
	<div class="space-y-6 pb-32 lg:pb-40">
		<!-- Back Button -->
		<button
			onclick={() => window.history.back()}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Album Header -->
		<div class="flex flex-col gap-8 md:flex-row">
			<!-- Album Cover -->
			{#if album.cover}
				<div
					class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-lg shadow-2xl md:w-80"
				>
					<img
						src={losslessAPI.getCoverUrl(album.cover, '640')}
						alt={album.title}
						class="h-full w-full object-cover"
					/>
				</div>
			{/if}

			<!-- Album Info -->
			<div class="flex flex-1 flex-col justify-end">
				<p class="mb-2 text-sm text-gray-400">ALBUM</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{album.title}</h1>

				{#if album.artist}
					<button
						onclick={() => album?.artist && goto(`/artist/${album.artist.id}`)}
						class="mb-4 text-left text-xl text-gray-300 hover:text-white hover:underline"
					>
						{album.artist.name}
					</button>
				{/if}

				<div class="mb-6 flex flex-wrap items-center gap-4 text-sm text-gray-400">
					{#if album.releaseDate}
						<div class="flex items-center gap-1">
							<Calendar size={16} />
							{new Date(album.releaseDate).getFullYear()}
						</div>
					{/if}
					{#if tracks.length > 0 || album.numberOfTracks}
						<div class="flex items-center gap-1">
							<Disc size={16} />
							{tracks.length || album.numberOfTracks} tracks
						</div>
					{/if}
					{#if totalDuration > 0}
						<div class="flex items-center gap-1">
							<Clock size={16} />
							{losslessAPI.formatDuration(totalDuration)} total
						</div>
					{/if}
					<!--
					{#if album.audioQuality}
						<div class="rounded bg-blue-900/30 px-2 py-1 text-xs font-semibold text-blue-400">
							{album.audioQuality}
						</div>
					{/if}
					-->
					{#if album.mediaMetadata?.tags}
						{#each album.mediaMetadata.tags as tag}
							<div class="rounded bg-blue-900/30 px-2 py-1 text-xs font-semibold text-blue-400">
								{tag}
							</div>
						{/each}
					{/if}
				</div>

				{#if tracks.length > 0}
					<div class="flex flex-wrap items-center gap-3">
						<button
							onclick={handlePlayAll}
							class="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-semibold transition-colors hover:bg-blue-700"
						>
							<Play size={20} fill="currentColor" />
							Play All
						</button>
						<button
							onclick={handleShufflePlay}
							class="flex items-center gap-2 rounded-full border border-purple-400/50 px-6 py-3 text-sm font-semibold text-purple-200 transition-colors hover:border-purple-300 hover:text-purple-100"
						>
							<Shuffle size={18} />
							Shuffle Play
						</button>
						<button
							onclick={handleDownloadAll}
							class="flex items-center gap-2 rounded-full border border-blue-400/40 px-6 py-3 text-sm font-semibold text-blue-300 transition-colors hover:border-blue-400 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isDownloadingAll}
						>
							<Download size={18} />
							{isDownloadingAll
								? `Downloading ${downloadedCount}/${tracks.length}`
								: 'Download All'}
						</button>
					</div>
					{#if downloadError}
						<p class="mt-2 text-sm text-red-400">{downloadError}</p>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Tracks -->
		<div class="mt-8 space-y-4">
			<h2 class="text-2xl font-bold">Tracks</h2>
			<TrackList {tracks} showAlbum={false} />
			{#if tracks.length === 0}
				<div class="rounded-lg border border-yellow-900 bg-yellow-900/20 p-6 text-yellow-300">
					<p>
						We couldn't find tracks for this album. Try refreshing or searching for individual
						songs.
					</p>
				</div>
			{/if}
			{#if album.copyright}
				<p class="pt-2 text-xs text-gray-500">{album.copyright}</p>
			{/if}
		</div>
	</div>
{/if}
