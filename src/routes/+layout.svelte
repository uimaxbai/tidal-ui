<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import QualitySelector from '$lib/components/QualitySelector.svelte';
	import { Music2 } from 'lucide-svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex min-h-screen flex-col bg-gray-900 text-white">
	<!-- Header -->
	<header class="sticky top-0 z-40 border-b border-gray-800 bg-gray-900">
		<div class="mx-auto max-w-screen-2xl px-4 py-4">
			<div class="flex items-center justify-between">
				<a href="/" class="flex items-center gap-3 transition-opacity hover:opacity-80">
					<Music2 size={32} class="text-blue-500" />
					<div>
						<h1 class="text-2xl font-bold">TIDAL UI</h1>
						<p class="text-xs text-gray-400">Privacy-focused streaming</p>
					</div>
				</a>

				<div class="flex items-center gap-4">
					<QualitySelector />
				</div>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1 pb-32">
		<div class="mx-auto max-w-screen-2xl px-4 py-6">
			{@render children?.()}
		</div>
	</main>

	<!-- Audio Player (Fixed at bottom) -->
	<AudioPlayer />
</div>
