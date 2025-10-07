<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
	import type { Track, Album, Artist, Playlist } from '$lib/types';
	import { playerStore } from '$lib/stores/player';
	import { goto } from '$app/navigation';

	let { data } = $props();

	function handleTrackSelect(track: Track) {
		playerStore.setQueue([track], 0);
		playerStore.play();
	}

	function handleAlbumSelect(album: Album) {
		goto(`/album/${album.id}`);
	}

	function handleArtistSelect(artist: Artist) {
		goto(`/artist/${artist.id}`);
	}

	function handlePlaylistSelect(playlist: Playlist) {
		goto(`/playlist/${playlist.uuid}`);
	}
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="description" content="Cool music streaming haha" />
</svelte:head>

<div class="space-y-8">
	<!-- Hero Section -->
	<div class="py-8 text-center">
		<div class="mb-4 flex items-end justify-center gap-2">
			<h2
				class="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-5xl font-bold text-transparent"
			>
				{data.title}
			</h2>
			<span class="text-sm text-gray-400">v1.9</span>
		</div>
		<p class="mx-auto max-w-2xl text-xl text-gray-400">{data.slogan}</p>
	</div>

	<!-- Search Interface -->
	<SearchInterface
		onTrackSelect={handleTrackSelect}
		onAlbumSelect={handleAlbumSelect}
		onArtistSelect={handleArtistSelect}
		onPlaylistSelect={handlePlaylistSelect}
	/>
</div>
