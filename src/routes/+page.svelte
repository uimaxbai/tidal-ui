<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
	import type { Track, Album, Artist, Playlist } from '$lib/types';
	import { playerStore } from '$lib/stores/player';
	import { goto } from '$app/navigation';

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
	<title>TIDAL UI - Privacy-focused Streaming</title>
	<meta
		name="description"
		content="Privacy-focused, cross-platform Tidal streaming interface"
	/>
</svelte:head>

<div class="space-y-8">
	<!-- Hero Section -->
	<div class="text-center py-12">
		<h2 class="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
			Welcome to TIDAL UI
		</h2>
		<p class="text-xl text-gray-400 max-w-2xl mx-auto">
			Experience high-fidelity music streaming with support for Hi-Res lossless, MQA, Dolby Atmos,
			and more. Privacy-focused and completely free.
		</p>
	</div>

	<!-- Features -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
		<div class="bg-gray-800 p-6 rounded-lg border border-gray-700">
			<div class="text-blue-500 text-2xl mb-2">🎵</div>
			<h3 class="text-lg font-semibold mb-2">High-Quality Audio</h3>
			<p class="text-sm text-gray-400">
				Stream in up to 24-bit, 192 kHz Hi-Res lossless quality with support for MQA and Dolby Atmos
			</p>
		</div>

		<div class="bg-gray-800 p-6 rounded-lg border border-gray-700">
			<div class="text-blue-500 text-2xl mb-2">🔒</div>
			<h3 class="text-lg font-semibold mb-2">Privacy-Focused</h3>
			<p class="text-sm text-gray-400">
				No tracking, no ads, no data collection. Just pure music streaming
			</p>
		</div>

		<div class="bg-gray-800 p-6 rounded-lg border border-gray-700">
			<div class="text-blue-500 text-2xl mb-2">📥</div>
			<h3 class="text-lg font-semibold mb-2">Download Support</h3>
			<p class="text-sm text-gray-400">
				Download your favorite tracks in any quality for offline listening
			</p>
		</div>
	</div>

	<!-- Search Interface -->
	<SearchInterface
		onTrackSelect={handleTrackSelect}
		onAlbumSelect={handleAlbumSelect}
		onArtistSelect={handleArtistSelect}
		onPlaylistSelect={handlePlaylistSelect}
	/>
</div>

