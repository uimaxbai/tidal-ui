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
		<div class="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
	</div>
{:else if error}
	<div class="max-w-2xl mx-auto py-12">
		<div class="bg-red-900/20 border border-red-900 rounded-lg p-6">
			<h2 class="text-xl font-semibold text-red-400 mb-2">Error Loading Album</h2>
			<p class="text-red-300">{error}</p>
			<button
				onclick={() => goto('/')}
				class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
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
			class="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Album Header -->
		<div class="flex flex-col md:flex-row gap-8">
			<!-- Album Cover -->
			{#if album.cover}
				<div class="w-full md:w-80 aspect-square rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
					<img
						src={tidalAPI.getCoverUrl(album.cover, '640')}
						alt={album.title}
						class="w-full h-full object-cover"
					/>
				</div>
			{/if}

			<!-- Album Info -->
			<div class="flex-1 flex flex-col justify-end">
				<p class="text-sm text-gray-400 mb-2">ALBUM</p>
				<h1 class="text-4xl md:text-6xl font-bold mb-4">{album.title}</h1>
				
				{#if album.artist}
					<button
						onclick={() => album?.artist && goto(`/artist/${album.artist.id}`)}
						class="text-xl text-gray-300 hover:text-white hover:underline mb-4 text-left"
					>
						{album.artist.name}
					</button>
				{/if}

				<div class="flex flex-wrap items-center gap-4 text-sm text-gray-400 mb-6">
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
						<div class="px-2 py-1 bg-blue-900/30 text-blue-400 rounded text-xs font-semibold">
							{album.audioQuality}
						</div>
					{/if}
					{#if album.mediaMetadata?.tags}
						{#each album.mediaMetadata.tags as tag}
							<div class="px-2 py-1 bg-purple-900/30 text-purple-400 rounded text-xs font-semibold">
								{tag}
							</div>
						{/each}
					{/if}
				</div>

				{#if tracks.length > 0}
					<button
						onclick={handlePlayAll}
						class="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-full font-semibold transition-colors w-fit"
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
				<h2 class="text-2xl font-bold mb-4">Tracks</h2>
				<TrackList {tracks} showAlbum={false} showCover={false} />
			</div>
		{:else}
			<div class="bg-yellow-900/20 border border-yellow-900 rounded-lg p-6 text-yellow-400">
				<p>Track listing not available. This feature requires additional API endpoints.</p>
				<p class="text-sm mt-2 text-gray-400">
					You can still search for individual tracks from this album using the search feature.
				</p>
			</div>
		{/if}
	</div>
{/if}
