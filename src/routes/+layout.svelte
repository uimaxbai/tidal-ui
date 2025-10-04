<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';

	let { children } = $props();
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let viewportHeight = $state(0);
	const mainMinHeight = $derived(() => Math.max(0, viewportHeight - headerHeight - playerHeight));
	const contentPaddingBottom = $derived(() => Math.max(playerHeight, 24));

	const handlePlayerHeight = (height: number) => {
		playerHeight = height;
	};

	onMount(() => {
		const updateViewportHeight = () => {
			viewportHeight = window.innerHeight;
		};
		updateViewportHeight();
		window.addEventListener('resize', updateViewportHeight);
		return () => window.removeEventListener('resize', updateViewportHeight);
	});

</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&family=Host+Grotesk:ital,wght@0,300..800;1,300..800&family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
</svelte:head>

<div class="flex min-h-screen flex-col bg-neutral-800 text-white">
	<!-- Header -->
	<header
		class="sticky top-0 z-40 border-b border-gray-800 bg-neutral-800"
		bind:clientHeight={headerHeight}
	>
		<div class="mx-auto max-w-screen-2xl px-4 py-4">
			<div class="flex items-center justify-between">
				<a href="/" class="flex items-center gap-3 transition-opacity hover:opacity-80">
					<div>
						<h1 class="text-2xl font-bold">BiniTidal</h1>
						<p class="text-xs text-gray-400">sailing on PCM tidal waves</p>
					</div>
				</a>

				<div class="flex items-center gap-4">
					<a target="_blank" rel="noopener noreferrer" href="https://github.com/uimaxbai/tidal-ui" class="flex items-center gap-2 rounded-lg border-gray-800 bg-neutral-900 px-4 py-2 text-white transition-colors hover:bg-gray-800 border border-gray-800" aria-label="Project GitHub">
						<!-- GitHub SVG from https://github.com/logos -->
						<svg viewBox="0 0 98 96" class="w-4 h-4 flex align-middle flex-shrink-0" aria-hidden="true" width="98" height="96" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" fill="#fff"/></svg>
						GitHub
					</a>
				</div>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main
		class="flex-1 rounded-t-2xl bg-neutral-900"
		style={`min-height: ${mainMinHeight}px;`}
	>
		<div
			class="mx-auto max-w-screen-2xl px-4 py-6"
			style={`padding-bottom: ${contentPaddingBottom}px;`}
		>
			{@render children?.()}
		</div>
	</main>

	<!-- Audio Player (Fixed at bottom) -->
	<AudioPlayer onHeightChange={handlePlayerHeight} />
</div>

<style>
	:global(body) {
		font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI',
			Roboto, 'Helvetica Neue', Arial, sans-serif;
	}
</style>
