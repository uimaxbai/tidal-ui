<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import { navigating } from '$app/stores';
	import type { Navigation } from '@sveltejs/kit';

	let { children, data } = $props();
	const pageTitle = $derived(data?.title ?? 'BiniTidal');
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let viewportHeight = $state(0);
	let navigationState = $state<Navigation | null>(null);
	const mainMinHeight = $derived(() => Math.max(0, viewportHeight - headerHeight - playerHeight));
	const contentPaddingBottom = $derived(() => Math.max(playerHeight, 24));
	const mainMarginBottom = $derived(() => Math.max(playerHeight, 128));
	const FRIENDLY_ROUTE_MESSAGES: Record<string, string> = {
		album: 'Opening album',
		artist: 'Visiting artist',
		playlist: 'Loading playlist'
	};

	const navigationMessage = $derived(() => {
		if (!navigationState) return '';
		const pathname = navigationState.to?.url?.pathname ?? '';
		const [primarySegment] = pathname.split('/').filter(Boolean);
		if (!primarySegment) return 'Loading';
		const key = primarySegment.toLowerCase();
		if (key in FRIENDLY_ROUTE_MESSAGES) {
			return FRIENDLY_ROUTE_MESSAGES[key]!;
		}
		const normalized = key.replace(/[-_]+/g, ' ');
		return `Loading ${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
	});

	const handlePlayerHeight = (height: number) => {
		playerHeight = height;
	};

	onMount(() => {
		const updateViewportHeight = () => {
			viewportHeight = window.innerHeight;
		};
		updateViewportHeight();
		window.addEventListener('resize', updateViewportHeight);
		const unsubscribe = navigating.subscribe((value) => {
			navigationState = value;
		});
		return () => {
			window.removeEventListener('resize', updateViewportHeight);
			unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&family=Host+Grotesk:ital,wght@0,300..800;1,300..800&family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&display=swap"
		rel="stylesheet"
	/>
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
						<h1 class="text-2xl font-bold">{data.title}</h1>
						<p class="text-xs text-gray-400">sailing on PCM tidal waves</p>
					</div>
				</a>

				<div class="flex items-center gap-4">
					<a
						target="_blank"
						rel="noopener noreferrer"
						href="https://github.com/uimaxbai/tidal-ui"
						class="flex items-center gap-2 rounded-lg border border-gray-800 bg-neutral-900 px-4 py-2 text-white transition-colors hover:bg-gray-800"
						aria-label="Project GitHub"
					>
						<!-- GitHub SVG from https://github.com/logos -->
						<svg
							viewBox="0 0 98 96"
							class="flex h-4 w-4 flex-shrink-0 align-middle"
							aria-hidden="true"
							width="98"
							height="96"
							xmlns="http://www.w3.org/2000/svg"
							><path
								fill-rule="evenodd"
								clip-rule="evenodd"
								d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
								fill="#fff"
							/></svg
						>
						GitHub
					</a>
				</div>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="mb-32 flex-1 rounded-t-2xl bg-neutral-900">
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

{#if navigationState}
	<div
		transition:fade={{ duration: 200 }}
		class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-neutral-950/80 backdrop-blur-xl"
	>
		<div class="absolute inset-x-0 top-0 h-1 overflow-hidden bg-white/5">
			<div class="navigation-progress"></div>
		</div>
		<div class="relative flex h-28 w-28 items-center justify-center">
			<span
				class="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/30 via-purple-500/20 to-transparent blur-2xl"
			></span>
			<span class="absolute inset-0 rounded-full border border-white/10"></span>
			<span class="absolute inset-2 rounded-full border-2 border-white/30"></span>
			<span class="animate-spin-slower absolute inset-0 rounded-full border-t-4 border-blue-400/90"
			></span>
			<span class="relative flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/20">
				<span
					class="h-6 w-6 animate-pulse rounded-full bg-gradient-to-br from-blue-400 to-purple-400 blur-[1px]"
				></span>
			</span>
		</div>
		<div class="flex flex-col items-center gap-2 text-center" role="status" aria-live="polite">
			<span class="text-xs tracking-[0.4em] text-blue-300/80 uppercase">Hang tight</span>
		</div>
	</div>
{/if}

<style>
	:global(body) {
		font-family:
			'Figtree',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			'Helvetica Neue',
			Arial,
			sans-serif;
	}

	.navigation-progress {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -40%;
		width: 60%;
		background: linear-gradient(90deg, transparent, rgba(96, 165, 250, 0.9), transparent);
		animation: shimmer 1.2s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% {
			transform: translateX(0);
			opacity: 0.2;
		}
		50% {
			transform: translateX(250%);
			opacity: 0.85;
		}
		100% {
			transform: translateX(400%);
			opacity: 0;
		}
	}

	:global(.animate-spin-slower) {
		animation: spin-slower 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes spin-slower {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
