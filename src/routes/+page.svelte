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
	<meta name="description" content="Privacy-focused, cross-platform Tidal streaming interface" />
</svelte:head>

<div class="space-y-8">
	<!-- Hero Section -->
	<div class="py-12 text-center">
		<h2
			class="mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-5xl font-bold text-transparent"
		>
			Welcome to TIDAL UI
		</h2>
		<p class="mx-auto max-w-2xl text-xl text-gray-400">
			Experience high-fidelity music streaming with support for Hi-Res lossless, MQA, Dolby Atmos,
			and more. Privacy-focused and completely free.
		</p>
	</div>

	<!-- Features -->
	<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
		<div class="rounded-lg border border-gray-700 bg-gray-800 p-6">
			<div class="mb-2 text-2xl text-blue-500">🎵</div>
			<h3 class="mb-2 text-lg font-semibold">High-Quality Audio</h3>
			<p class="text-sm text-gray-400">
				Stream in up to 24-bit, 192 kHz Hi-Res lossless quality with support for MQA and Dolby Atmos
			</p>
		</div>

		<div class="rounded-lg border border-gray-700 bg-gray-800 p-6">
			<div class="mb-2 text-2xl text-blue-500">🔒</div>
			<h3 class="mb-2 text-lg font-semibold">Privacy-Focused</h3>
			<p class="text-sm text-gray-400">
				No tracking, no ads, no data collection. Just pure music streaming
			</p>
		</div>

		<div class="rounded-lg border border-gray-700 bg-gray-800 p-6">
			<div class="mb-2 text-2xl text-blue-500">📥</div>
			<h3 class="mb-2 text-lg font-semibold">Download Support</h3>
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


