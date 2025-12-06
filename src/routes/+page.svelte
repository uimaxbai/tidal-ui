<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
	import type { Track, PlayableTrack } from '$lib/types';
	import { playerStore } from '$lib/stores/player';

	let { data } = $props();

	function handleTrackSelect(track: PlayableTrack) {
		playerStore.setQueue([track], 0);
		playerStore.play();
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
				class="bg-clip-text text-5xl font-bold text-transparent"
				style="background-image: linear-gradient(135deg, #667eea 0%, #764ba2 100%);"
			>
				{data.title}
			</h2>
			<span class="text-sm text-gray-400">v3.0</span>
		</div>
		<p class="mx-auto max-w-2xl text-xl text-gray-400">{data.slogan}</p>
	</div>

	<!-- Search Interface -->
	<SearchInterface onTrackSelect={handleTrackSelect} />
</div>
