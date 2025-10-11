<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import TrackList from '$lib/components/TrackList.svelte';
	import type { Playlist, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import { ArrowLeft, Play, User, Clock } from 'lucide-svelte';
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
			const data = await losslessAPI.getPlaylist(id);
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
		<div class="h-16 w-16 animate-spin rounded-full border-b-2 border-blue-500"></div>
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Playlist</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if playlist}
	<div class="space-y-6">
		<!-- Back Button -->
		<button
			onclick={() => window.history.back()}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Playlist Header -->
		<div class="flex flex-col gap-8 md:flex-row">
			<!-- Playlist Cover -->
			{#if playlist.image}
				<div
					class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-lg shadow-2xl md:w-80"
				>
					<img
						src={losslessAPI.getCoverUrl(playlist.image, '640')}
						alt={playlist.title}
						class="h-full w-full object-cover"
					/>
				</div>
			{/if}

			<!-- Playlist Info -->
			<div class="flex flex-1 flex-col justify-end">
				<p class="mb-2 text-sm text-gray-400">PLAYLIST</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{playlist.title}</h1>

				{#if playlist.description}
					<p class="mb-4 text-gray-300">{playlist.description}</p>
				{/if}

				<div class="mb-4 flex items-center gap-2">
					{#if playlist.creator.picture}
						<img
							src={losslessAPI.getCoverUrl(playlist.creator.picture, '80')}
							alt={playlist.creator.name}
							class="h-8 w-8 rounded-full"
						/>
					{:else}
						<div class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700">
							<User size={16} class="text-gray-400" />
						</div>
					{/if}
					<span class="text-sm text-gray-300">{playlist.creator.name}</span>
				</div>

				<div class="mb-6 flex flex-wrap items-center gap-4 text-sm text-gray-400">
					<div>{playlist.numberOfTracks} tracks</div>
					{#if playlist.duration}
						<div class="flex items-center gap-1">
							<Clock size={16} />
							{formatDuration(playlist.duration)}
						</div>
					{/if}
					{#if playlist.type}
						<div class="rounded bg-purple-900/30 px-2 py-1 text-xs font-semibold text-purple-400">
							{playlist.type}
						</div>
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

		<!-- Promoted Artists -->
		{#if playlist.promotedArtists && playlist.promotedArtists.length > 0}
			<div>
				<h3 class="mb-3 text-sm font-semibold text-gray-400">Featured Artists</h3>
				<div class="flex flex-wrap gap-2">
					{#each playlist.promotedArtists as artist}
						<a
							href={`/artist/${artist.id}`}
							data-sveltekit-preload-data
							class="rounded-full bg-gray-800 px-3 py-1.5 text-sm transition-colors hover:bg-gray-700"
						>
							{artist.name}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tracks -->
		{#if tracks.length > 0}
			<div class="mt-8">
				<h2 class="mb-4 text-2xl font-bold">Tracks</h2>
				<TrackList {tracks} />
			</div>
		{:else}
			<div class="rounded-lg bg-gray-800 p-6 text-gray-400">
				<p>No tracks in this playlist.</p>
			</div>
		{/if}

		<!-- Metadata -->
		<div class="space-y-1 text-xs text-gray-500">
			{#if playlist.created}
				<p>Created: {new Date(playlist.created).toLocaleDateString()}</p>
			{/if}
			{#if playlist.lastUpdated}
				<p>Last updated: {new Date(playlist.lastUpdated).toLocaleDateString()}</p>
			{/if}
		</div>
	</div>
{/if}
