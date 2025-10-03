<script lang="ts">
	import { page } from '$app/stores';
	import { tidalAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import type { Album } from '$lib/types';
	import { onMount } from 'svelte';
	import { ArrowLeft, Play, Calendar, Disc } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { playerStore } from '$lib/stores/player';

	let album = $state<Album | null>(null);
	let tracks = $state<any[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

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
			const data = await tidalAPI.getAlbum(id);
			album = data;

			// Note: The API doesn't return tracks with album details
			// In a real implementation, you'd need an endpoint to get album tracks
			// For now, we'll show the album info
			tracks = [];
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
	<div class="space-y-6">
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
						src={tidalAPI.getCoverUrl(album.cover, '640')}
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
					{#if album.numberOfTracks}
						<div class="flex items-center gap-1">
							<Disc size={16} />
							{album.numberOfTracks} tracks
						</div>
					{/if}
					{#if album.audioQuality}
						<div class="rounded bg-blue-900/30 px-2 py-1 text-xs font-semibold text-blue-400">
							{album.audioQuality}
						</div>
					{/if}
					{#if album.mediaMetadata?.tags}
						{#each album.mediaMetadata.tags as tag}
							<div class="rounded bg-purple-900/30 px-2 py-1 text-xs font-semibold text-purple-400">
								{tag}
							</div>
						{/each}
					{/if}
				</div>

				{#if tracks.length > 0}
					<button
						onclick={handlePlayAll}
						class="flex w-fit items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-semibold transition-colors hover:bg-blue-700"
					>
						<Play size={20} fill="currentColor" />
						Play All
					</button>
				{/if}
			</div>
		</div>

		<!-- Copyright -->
		{#if album.copyright}
			<p class="text-xs text-gray-500">{album.copyright}</p>
		{/if}

		<!-- Tracks -->
		{#if tracks.length > 0}
			<div class="mt-8">
				<h2 class="mb-4 text-2xl font-bold">Tracks</h2>
				<TrackList {tracks} showAlbum={false} showCover={false} />
			</div>
		{:else}
			<div class="rounded-lg border border-yellow-900 bg-yellow-900/20 p-6 text-yellow-400">
				<p>Track listing not available. This feature requires additional API endpoints.</p>
				<p class="mt-2 text-sm text-gray-400">
					You can still search for individual tracks from this album using the search feature.
				</p>
			</div>
		{/if}
	</div>
{/if}
