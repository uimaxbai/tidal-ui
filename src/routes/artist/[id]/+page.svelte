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
		<div class="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
	</div>
{:else if error}
	<div class="max-w-2xl mx-auto py-12">
		<div class="bg-red-900/20 border border-red-900 rounded-lg p-6">
			<h2 class="text-xl font-semibold text-red-400 mb-2">Error Loading Artist</h2>
			<p class="text-red-300">{error}</p>
			<button
				onclick={() => goto('/')}
				class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
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
			class="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Artist Header -->
		<div class="flex flex-col md:flex-row gap-8 items-start md:items-end">
			<!-- Artist Picture -->
			<div class="w-full md:w-80 aspect-square rounded-full overflow-hidden shadow-2xl flex-shrink-0 bg-gray-800">
				{#if artistImage}
					<img src={artistImage} alt={artist.name} class="w-full h-full object-cover" />
				{:else}
					<div class="w-full h-full flex items-center justify-center">
						<User size={120} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Artist Info -->
			<div class="flex-1">
				<p class="text-sm text-gray-400 mb-2">ARTIST</p>
				<h1 class="text-4xl md:text-6xl font-bold mb-4">{artist.name}</h1>

				<div class="flex flex-wrap items-center gap-4 mb-6">
					{#if artist.popularity}
						<div class="text-sm text-gray-400">
							Popularity: <span class="text-white font-semibold">{artist.popularity}</span>
						</div>
					{/if}
					{#if artist.artistTypes && artist.artistTypes.length > 0}
						{#each artist.artistTypes as type}
							<div class="px-3 py-1 bg-blue-900/30 text-blue-400 rounded-full text-xs font-semibold">
								{type}
							</div>
						{/each}
					{/if}
				</div>

				{#if artist.artistRoles && artist.artistRoles.length > 0}
					<div class="mb-4">
						<h3 class="text-sm font-semibold text-gray-400 mb-2">Roles</h3>
						<div class="flex flex-wrap gap-2">
							{#each artist.artistRoles as role}
								<div class="px-3 py-1 bg-gray-800 rounded-full text-xs text-gray-300">
									{role.category}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Additional Content -->
		<div class="bg-yellow-900/20 border border-yellow-900 rounded-lg p-6 text-yellow-400 mt-8">
			<p>Artist discography and tracks not available.</p>
			<p class="text-sm mt-2 text-gray-400">
				To explore this artist's music, use the search feature to find their tracks and albums.
			</p>
		</div>

		{#if artist.url}
			<a
				href={artist.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block text-blue-400 hover:text-blue-300 text-sm"
			>
				View on TIDAL →
			</a>
		{/if}
	</div>
{/if}
