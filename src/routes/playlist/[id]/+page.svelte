<script lang="ts">
	import { page } from '$app/stores';
	import { tidalAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import type { Playlist, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import { ArrowLeft, Play, User, Clock } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { playerStore } from '$lib/stores/player';

	let playlist = $state<Playlist | null>(null);
	let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const playlistId = $derived($page.params.id);

	onMount(async () => {
		if (playlistId) {
			await loadPlaylist(playlistId);
		}
	});

	async function loadPlaylist(id: string) {
		try {
			isLoading = true;
			error = null;
			const data = await tidalAPI.getPlaylist(id);
			playlist = data.playlist;
			tracks = data.items.map((item) => item.item);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load playlist';
			console.error('Failed to load playlist:', err);
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

	function formatDuration(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		if (hours > 0) {
			return `${hours} hr ${minutes} min`;
		}
		return `${minutes} min`;
	}
</script>

<svelte:head>
	<title>{playlist?.title || 'Playlist'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<div class="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
	</div>
{:else if error}
	<div class="max-w-2xl mx-auto py-12">
		<div class="bg-red-900/20 border border-red-900 rounded-lg p-6">
			<h2 class="text-xl font-semibold text-red-400 mb-2">Error Loading Playlist</h2>
			<p class="text-red-300">{error}</p>
			<button
				onclick={() => goto('/')}
				class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
			>
				Go Home
			</button>
		</div>
	</div>
{:else if playlist}
	<div class="space-y-6">
		<!-- Back Button -->
		<button
			onclick={() => window.history.back()}
			class="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Playlist Header -->
		<div class="flex flex-col md:flex-row gap-8">
			<!-- Playlist Cover -->
			{#if playlist.image}
				<div class="w-full md:w-80 aspect-square rounded-lg overflow-hidden shadow-2xl flex-shrink-0">
					<img
						src={tidalAPI.getCoverUrl(playlist.image, '640')}
						alt={playlist.title}
						class="w-full h-full object-cover"
					/>
				</div>
			{/if}

			<!-- Playlist Info -->
			<div class="flex-1 flex flex-col justify-end">
				<p class="text-sm text-gray-400 mb-2">PLAYLIST</p>
				<h1 class="text-4xl md:text-6xl font-bold mb-4">{playlist.title}</h1>

				{#if playlist.description}
					<p class="text-gray-300 mb-4">{playlist.description}</p>
				{/if}

				<div class="flex items-center gap-2 mb-4">
					{#if playlist.creator.picture}
						<img
							src={tidalAPI.getCoverUrl(playlist.creator.picture, '80')}
							alt={playlist.creator.name}
							class="w-8 h-8 rounded-full"
						/>
					{:else}
						<div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
							<User size={16} class="text-gray-400" />
						</div>
					{/if}
					<span class="text-sm text-gray-300">{playlist.creator.name}</span>
				</div>

				<div class="flex flex-wrap items-center gap-4 text-sm text-gray-400 mb-6">
					<div>{playlist.numberOfTracks} tracks</div>
					{#if playlist.duration}
						<div class="flex items-center gap-1">
							<Clock size={16} />
							{formatDuration(playlist.duration)}
						</div>
					{/if}
					{#if playlist.type}
						<div class="px-2 py-1 bg-purple-900/30 text-purple-400 rounded text-xs font-semibold">
							{playlist.type}
						</div>
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

		<!-- Promoted Artists -->
		{#if playlist.promotedArtists && playlist.promotedArtists.length > 0}
			<div>
				<h3 class="text-sm font-semibold text-gray-400 mb-3">Featured Artists</h3>
				<div class="flex flex-wrap gap-2">
					{#each playlist.promotedArtists as artist}
						<button
							onclick={() => goto(`/artist/${artist.id}`)}
							class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-full text-sm transition-colors"
						>
							{artist.name}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tracks -->
		{#if tracks.length > 0}
			<div class="mt-8">
				<h2 class="text-2xl font-bold mb-4">Tracks</h2>
				<TrackList {tracks} />
			</div>
		{:else}
			<div class="bg-gray-800 rounded-lg p-6 text-gray-400">
				<p>No tracks in this playlist.</p>
			</div>
		{/if}

		<!-- Metadata -->
		<div class="text-xs text-gray-500 space-y-1">
			{#if playlist.created}
				<p>Created: {new Date(playlist.created).toLocaleDateString()}</p>
			{/if}
			{#if playlist.lastUpdated}
				<p>Last updated: {new Date(playlist.lastUpdated).toLocaleDateString()}</p>
			{/if}
		</div>
	</div>
{/if}
