<script lang="ts">
	import { tidalAPI } from '$lib/api';
	import type { Track, Album, Artist, Playlist } from '$lib/types';
	import { Search, Music, User, Disc, ListMusic } from 'lucide-svelte';

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

	async function handleSearch() {
		if (!query.trim()) return;

		isLoading = true;
		error = null;

		try {
			switch (activeTab) {
				case 'tracks': {
					const response = await tidalAPI.searchTracks(query);
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
			class="w-full px-4 py-3 pl-12 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors"
		/>
		<Search class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
		<button
			onclick={handleSearch}
			disabled={isLoading || !query.trim()}
			class="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			{isLoading ? 'Searching...' : 'Search'}
		</button>
	</div>

	<!-- Tabs -->
	<div class="flex gap-2 mb-6 border-b border-gray-700">
		<button
			onclick={() => handleTabChange('tracks')}
			class="flex items-center gap-2 px-4 py-2 border-b-2 transition-colors {activeTab ===
			'tracks'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<Music size={18} />
			Tracks
		</button>
		<button
			onclick={() => handleTabChange('albums')}
			class="flex items-center gap-2 px-4 py-2 border-b-2 transition-colors {activeTab ===
			'albums'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<Disc size={18} />
			Albums
		</button>
		<button
			onclick={() => handleTabChange('artists')}
			class="flex items-center gap-2 px-4 py-2 border-b-2 transition-colors {activeTab ===
			'artists'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<User size={18} />
			Artists
		</button>
		<button
			onclick={() => handleTabChange('playlists')}
			class="flex items-center gap-2 px-4 py-2 border-b-2 transition-colors {activeTab ===
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
			<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
		</div>
	{/if}

	<!-- Error State -->
	{#if error}
		<div class="bg-red-900/20 border border-red-900 rounded-lg p-4 text-red-400">
			{error}
		</div>
	{/if}

	<!-- Results -->
	{#if !isLoading && !error}
		{#if activeTab === 'tracks' && tracks.length > 0}
			<div class="space-y-2">
				{#each tracks as track}
					<button
						onclick={() => onTrackSelect?.(track)}
						class="w-full flex items-center gap-3 p-3 bg-gray-800 hover:bg-gray-750 rounded-lg transition-colors text-left group"
					>
						{#if track.album.cover}
							<img
								src={tidalAPI.getCoverUrl(track.album.cover, '80')}
								alt={track.title}
								class="w-12 h-12 rounded object-cover"
							/>
						{/if}
						<div class="flex-1 min-w-0">
							<h3 class="font-semibold text-white truncate group-hover:text-blue-400">
								{track.title}
							</h3>
							<p class="text-sm text-gray-400 truncate">{track.artist.name}</p>
							<p class="text-xs text-gray-500">
								{track.album.title} • {track.audioQuality}
							</p>
						</div>
						<div class="text-gray-400 text-sm">{tidalAPI.formatDuration(track.duration)}</div>
					</button>
				{/each}
			</div>
		{:else if activeTab === 'albums' && albums.length > 0}
			<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
				{#each albums as album}
					<button
						onclick={() => onAlbumSelect?.(album)}
						class="text-left group"
					>
						<div class="relative aspect-square mb-2 overflow-hidden rounded-lg">
							{#if album.cover}
								<img
									src={tidalAPI.getCoverUrl(album.cover, '640')}
									alt={album.title}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform"
								/>
							{/if}
						</div>
						<h3 class="font-semibold text-white truncate group-hover:text-blue-400">
							{album.title}
						</h3>
						{#if album.artist}
							<p class="text-sm text-gray-400 truncate">{album.artist.name}</p>
						{/if}
						{#if album.releaseDate}
							<p class="text-xs text-gray-500">{album.releaseDate.split('-')[0]}</p>
						{/if}
					</button>
				{/each}
			</div>
		{:else if activeTab === 'artists' && artists.length > 0}
			<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
				{#each artists as artist}
					<button
						onclick={() => onArtistSelect?.(artist)}
						class="text-center group"
					>
						<div class="relative aspect-square mb-2 overflow-hidden rounded-full">
							{#if artist.picture}
								<img
									src={tidalAPI.getArtistPictureUrl(artist.picture)}
									alt={artist.name}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform"
								/>
							{:else}
								<div class="w-full h-full bg-gray-800 flex items-center justify-center">
									<User size={48} class="text-gray-600" />
								</div>
							{/if}
						</div>
						<h3 class="font-semibold text-white truncate group-hover:text-blue-400">
							{artist.name}
						</h3>
						<p class="text-xs text-gray-500">Artist</p>
					</button>
				{/each}
			</div>
		{:else if activeTab === 'playlists' && playlists.length > 0}
			<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
				{#each playlists as playlist}
					<button
						onclick={() => onPlaylistSelect?.(playlist)}
						class="text-left group"
					>
						<div class="relative aspect-square mb-2 overflow-hidden rounded-lg">
							{#if playlist.image}
								<img
									src={tidalAPI.getCoverUrl(playlist.image, '640')}
									alt={playlist.title}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform"
								/>
							{/if}
						</div>
						<h3 class="font-semibold text-white truncate group-hover:text-blue-400">
							{playlist.title}
						</h3>
						<p class="text-sm text-gray-400 truncate">{playlist.creator.name}</p>
						<p class="text-xs text-gray-500">{playlist.numberOfTracks} tracks</p>
					</button>
				{/each}
			</div>
		{:else if query.trim() && !isLoading}
			<div class="text-center py-12 text-gray-400">
				<p>No results found for "{query}"</p>
			</div>
		{/if}
	{/if}
</div>
