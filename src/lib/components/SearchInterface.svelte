<script lang="ts">
	import { tidalAPI } from '$lib/api';
	import { playerStore } from '$lib/stores/player';
	import type { Track, Album, Artist, Playlist } from '$lib/types';
	import { Search, Music, User, Disc, ListMusic, Download } from 'lucide-svelte';

	type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

	let query = $state('');
	let activeTab = $state<SearchTab>('tracks');
	let isLoading = $state(false);
	let tracks = $state<Track[]>([]);
	let albums = $state<Album[]>([]);
	let artists = $state<Artist[]>([]);
	let playlists = $state<Playlist[]>([]);
	let error = $state<string | null>(null);

	interface Props {
		onTrackSelect?: (track: Track) => void;
		onAlbumSelect?: (album: Album) => void;
		onArtistSelect?: (artist: Artist) => void;
		onPlaylistSelect?: (playlist: Playlist) => void;
	}

	let { onTrackSelect, onAlbumSelect, onArtistSelect, onPlaylistSelect }: Props = $props();

	async function fetchWithRetry<T>(action: () => Promise<T>, attempts = 3, delayMs = 250): Promise<T> {
		let lastError: unknown = null;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				return await action();
			} catch (err) {
				lastError = err;
				if (attempt < attempts) {
					await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
				}
			}
		}
		throw lastError instanceof Error ? lastError : new Error('Request failed');
	}

	async function handleDownload(track: Track, event: MouseEvent) {
		event.stopPropagation();

		try {
			const filename = `${track.artist.name} - ${track.title}.flac`;
			await tidalAPI.downloadTrack(track.id, $playerStore.quality, filename);
		} catch (err) {
			console.error('Failed to download track:', err);
			alert('Failed to download track. Please try again.');
		}
	}

	function handleTrackActivation(track: Track) {
		onTrackSelect?.(track);
	}

	function handleTrackKeydown(event: KeyboardEvent, track: Track) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleTrackActivation(track);
		}
	}

	async function handleSearch() {
		if (!query.trim()) return;

		isLoading = true;
		error = null;

		try {
			switch (activeTab) {
				case 'tracks': {
					const response = await fetchWithRetry(() => tidalAPI.searchTracks(query));
					tracks = response.items;
					break;
				}
				case 'albums': {
					const response = await tidalAPI.searchAlbums(query);
					albums = response.items;
					break;
				}
				case 'artists': {
					const response = await tidalAPI.searchArtists(query);
					artists = response.items;
					break;
				}
				case 'playlists': {
					const response = await tidalAPI.searchPlaylists(query);
					playlists = response.items;
					break;
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Search failed';
			console.error('Search error:', err);
		} finally {
			isLoading = false;
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}

	function handleTabChange(tab: SearchTab) {
		activeTab = tab;
		if (query.trim()) {
			handleSearch();
		}
	}
</script>

<div class="w-full">
	<!-- Search Input -->
	<div class="relative mb-6">
		<input
			type="text"
			bind:value={query}
			onkeypress={handleKeyPress}
			placeholder="Search for tracks, artists, albums, or playlists..."
			class="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 pl-12 text-white transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
		/>
		<Search class="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400" size={20} />
		<button
			onclick={handleSearch}
			disabled={isLoading || !query.trim()}
			class="absolute top-1/2 right-2 -translate-y-1/2 rounded-md bg-blue-600 px-4 py-1.5 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{isLoading ? 'Searching...' : 'Search'}
		</button>
	</div>

	<!-- Tabs -->
	<div class="mb-6 flex gap-2 border-b border-gray-700">
		<button
			onclick={() => handleTabChange('tracks')}
			class="flex items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab === 'tracks'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<Music size={18} />
			Tracks
		</button>
		<button
			onclick={() => handleTabChange('albums')}
			class="flex items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab === 'albums'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<Disc size={18} />
			Albums
		</button>
		<button
			onclick={() => handleTabChange('artists')}
			class="flex items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab === 'artists'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<User size={18} />
			Artists
		</button>
		<button
			onclick={() => handleTabChange('playlists')}
			class="flex items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab ===
			'playlists'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<ListMusic size={18} />
			Playlists
		</button>
	</div>

	<!-- Loading State -->
	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500"></div>
		</div>
	{/if}

	<!-- Error State -->
	{#if error}
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-4 text-red-400">
			{error}
		</div>
	{/if}

	<!-- Results -->
	{#if !isLoading && !error}
		{#if activeTab === 'tracks' && tracks.length > 0}
			<div class="space-y-2">
				{#each tracks as track}
					<div
						role="button"
						tabindex="0"
						onclick={() => handleTrackActivation(track)}
						onkeydown={(event) => handleTrackKeydown(event, track)}
						class="hover:bg-gray-750 group flex w-full cursor-pointer items-center gap-3 rounded-lg bg-gray-800 p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						{#if track.album.cover}
							<img
								src={tidalAPI.getCoverUrl(track.album.cover, '80')}
								alt={track.title}
								class="h-12 w-12 rounded object-cover"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
								{track.title}
							</h3>
							<p class="truncate text-sm text-gray-400">{track.artist.name}</p>
							<p class="text-xs text-gray-500">
								{track.album.title} • {track.audioQuality}
							</p>
						</div>
						<div class="flex items-center gap-2 text-sm text-gray-400">
							<button
								onclick={(event) => handleDownload(track, event)}
								class="rounded-full p-2 text-gray-400 transition-colors hover:text-white"
								title="Download track"
								aria-label={`Download ${track.title}`}
							>
								<Download size={18} />
							</button>
							<span>{tidalAPI.formatDuration(track.duration)}</span>
						</div>
					</div>
				{/each}
			</div>
		{:else if activeTab === 'albums' && albums.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each albums as album}
					<button onclick={() => onAlbumSelect?.(album)} class="group text-left">
						<div class="relative mb-2 aspect-square overflow-hidden rounded-lg">
							{#if album.cover}
								<img
									src={tidalAPI.getCoverUrl(album.cover, '640')}
									alt={album.title}
									class="h-full w-full object-cover transition-transform group-hover:scale-105"
								/>
							{/if}
						</div>
						<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
							{album.title}
						</h3>
						{#if album.artist}
							<p class="truncate text-sm text-gray-400">{album.artist.name}</p>
						{/if}
						{#if album.releaseDate}
							<p class="text-xs text-gray-500">{album.releaseDate.split('-')[0]}</p>
						{/if}
					</button>
				{/each}
			</div>
		{:else if activeTab === 'artists' && artists.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each artists as artist}
					<button onclick={() => onArtistSelect?.(artist)} class="group text-center">
						<div class="relative mb-2 aspect-square overflow-hidden rounded-full">
							{#if artist.picture}
								<img
									src={tidalAPI.getArtistPictureUrl(artist.picture)}
									alt={artist.name}
									class="h-full w-full object-cover transition-transform group-hover:scale-105"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center bg-gray-800">
									<User size={48} class="text-gray-600" />
								</div>
							{/if}
						</div>
						<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
							{artist.name}
						</h3>
						<p class="text-xs text-gray-500">Artist</p>
					</button>
				{/each}
			</div>
		{:else if activeTab === 'playlists' && playlists.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each playlists as playlist}
					<button onclick={() => onPlaylistSelect?.(playlist)} class="group text-left">
						<div class="relative mb-2 aspect-square overflow-hidden rounded-lg">
							{#if playlist.image}
								<img
									src={tidalAPI.getCoverUrl(playlist.image, '640')}
									alt={playlist.title}
									class="h-full w-full object-cover transition-transform group-hover:scale-105"
								/>
							{/if}
						</div>
						<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
							{playlist.title}
						</h3>
						<p class="truncate text-sm text-gray-400">{playlist.creator.name}</p>
						<p class="text-xs text-gray-500">{playlist.numberOfTracks} tracks</p>
					</button>
				{/each}
			</div>
		{:else if query.trim() && !isLoading}
			<div class="py-12 text-center text-gray-400">
				<p>No results found for "{query}"</p>
			</div>
		{/if}
	{/if}
</div>
