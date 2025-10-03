<script lang="ts">
	import { page } from '$app/stores';
	import { tidalAPI } from '$lib/api';
	import type { Artist } from '$lib/types';
	import { onMount } from 'svelte';
	import { ArrowLeft, User } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let artist = $state<Artist | null>(null);
	let artistImage = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const artistId = $derived($page.params.id);

	onMount(async () => {
		if (artistId) {
			await loadArtist(parseInt(artistId));
		}
	});

	async function loadArtist(id: number) {
		try {
			isLoading = true;
			error = null;
			const data = await tidalAPI.getArtist(id);
			artist = data;

			// Get artist picture
			if (artist.picture) {
				artistImage = tidalAPI.getArtistPictureUrl(artist.picture);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load artist';
			console.error('Failed to load artist:', err);
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{artist?.name || 'Artist'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<div class="h-16 w-16 animate-spin rounded-full border-b-2 border-blue-500"></div>
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Artist</h2>
			<p class="text-red-300">{error}</p>
			<button
				onclick={() => goto('/')}
				class="mt-4 rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</button>
		</div>
	</div>
{:else if artist}
	<div class="space-y-6">
		<!-- Back Button -->
		<button
			onclick={() => window.history.back()}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Artist Header -->
		<div class="flex flex-col items-start gap-8 md:flex-row md:items-end">
			<!-- Artist Picture -->
			<div
				class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-full bg-gray-800 shadow-2xl md:w-80"
			>
				{#if artistImage}
					<img src={artistImage} alt={artist.name} class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full w-full items-center justify-center">
						<User size={120} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Artist Info -->
			<div class="flex-1">
				<p class="mb-2 text-sm text-gray-400">ARTIST</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{artist.name}</h1>

				<div class="mb-6 flex flex-wrap items-center gap-4">
					{#if artist.popularity}
						<div class="text-sm text-gray-400">
							Popularity: <span class="font-semibold text-white">{artist.popularity}</span>
						</div>
					{/if}
					{#if artist.artistTypes && artist.artistTypes.length > 0}
						{#each artist.artistTypes as type}
							<div
								class="rounded-full bg-blue-900/30 px-3 py-1 text-xs font-semibold text-blue-400"
							>
								{type}
							</div>
						{/each}
					{/if}
				</div>

				{#if artist.artistRoles && artist.artistRoles.length > 0}
					<div class="mb-4">
						<h3 class="mb-2 text-sm font-semibold text-gray-400">Roles</h3>
						<div class="flex flex-wrap gap-2">
							{#each artist.artistRoles as role}
								<div class="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
									{role.category}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Additional Content -->
		<div class="mt-8 rounded-lg border border-yellow-900 bg-yellow-900/20 p-6 text-yellow-400">
			<p>Artist discography and tracks not available.</p>
			<p class="mt-2 text-sm text-gray-400">
				To explore this artist's music, use the search feature to find their tracks and albums.
			</p>
		</div>

		{#if artist.url}
			<a
				href={artist.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block text-sm text-blue-400 hover:text-blue-300"
			>
				View on TIDAL →
			</a>
		{/if}
	</div>
{/if}
