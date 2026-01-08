<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
	import type { Track, PlayableTrack } from '$lib/types';
	import { playerStore } from '$lib/stores/player';
	import { onMount } from 'svelte';
	import { APP_VERSION } from '$lib/version';

	let { data } = $props();

	onMount(() => {
		if (APP_VERSION) {
			try {
				umami.track('app_loaded', { version: APP_VERSION, host: window.location.hostname } );
			} catch {}
		}
	});

	function handleTrackSelect(track: PlayableTrack) {
		playerStore.setQueue([track], 0);
		playerStore.play();
	}
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="description" content="Stream and download lossless music in Hi-Res, CD quality, and more" />
</svelte:head>

<div class="homepage">
	<!-- Hero Section -->
	<section class="hero">
		<div class="hero__content">
			<div class="hero__title-wrapper">
				<h1 class="hero__title">{data.title}</h1>
				<span class="hero__version text-gray-400">{APP_VERSION}</span>
			</div>
			<p class="hero__slogan">{data.slogan}</p>
		</div>
	</section>

	<!-- Search Interface -->
	<section class="search-section">
		<SearchInterface onTrackSelect={handleTrackSelect} />
	</section>
</div>

<style>
	.homepage {
		display: flex;
		flex-direction: column;
		gap: var(--space-10, 2.5rem);
	}

	.hero {
		padding: var(--space-10, 2.5rem) 0 var(--space-6, 1.5rem);
		text-align: center;
	}

	.hero__content {
		max-width: 42rem;
		margin: 0 auto;
	}

	.hero__title-wrapper {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3, 0.75rem);
		margin-bottom: var(--space-4, 1rem);
	}

	.hero__title {
		font-size: clamp(2.5rem, 8vw, 4rem);
		font-weight: 700;
		line-height: 1.1;
		margin: 0;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
		background-size: 200% 200%;
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: gradient-shift 8s ease infinite;
	}

	@keyframes gradient-shift {
		0%, 100% { background-position: 0% 50%; }
		50% { background-position: 100% 50%; }
	}

	.hero__version {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.05em;
	}

	@keyframes float {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-1px); }
	}

	.hero__slogan {
		font-size: clamp(1rem, 2.5vw, 1.25rem);
		color: rgba(148, 163, 184, 0.9);
		margin: 0;
		line-height: 1.6;
		max-width: 36rem;
		margin: 0 auto;
	}

	.search-section {
		width: 100%;
	}

	/* Mobile adjustments */
	@media (max-width: 640px) {
		.hero {
			padding: var(--space-6, 1.5rem) 0 var(--space-4, 1rem);
		}

		.hero__title-wrapper {
			flex-direction: column;
			align-items: center;
			gap: var(--space-2, 0.5rem);
		}

		.hero__version {
			margin-top: var(--space-1, 0.25rem);
		}
	}
</style>

