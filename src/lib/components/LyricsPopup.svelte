<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { currentTime, playerStore } from '$lib/stores/player';
	import { lyricsStore } from '$lib/stores/lyrics';
	import { formatArtists } from '$lib/utils';
	import { isSonglinkTrack } from '$lib/types';
	import { Maximize2, Minimize2, RefreshCw, X } from 'lucide-svelte';

	const COMPONENT_MODULE_URL =
		'https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics@0.6.5/dist/src/am-lyrics.min.js';
	const SEEK_FORCE_THRESHOLD_MS = 220;

	type LyricsMetadata = {
		title: string;
		artist: string;
		album?: string;
		query: string;
		durationMs?: number;
		isrc?: string;
	};

	type AmLyricsElement = HTMLElement & {
		currentTime: number;
		scrollToActiveLine?: () => void;
		scrollToInstrumental?: (index: number) => void;
		activeLineIndices?: number[];
		shadowRoot: ShadowRoot | null;
		updateComplete?: Promise<unknown>;
		__tidalScrollPatched?: boolean;
	};

	let amLyricsElement = $state<AmLyricsElement | null>(null);
	let scriptStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let scriptError = $state<string | null>(null);
	let pendingLoad: Promise<void> | null = null;
	let hasEscapeListener = false;

	let baseTimeMs = $state(0);
	let lyricsKey = $state('0:none');
	let metadata = $state<LyricsMetadata | null>(null);
	let animationFrameId: number | null = null;
	let lastBaseTimestamp = 0;
	let scrollPatchFrame: number | null = null;
	let lastRefreshedTrackId = $state<number | string | null>(null);

	$effect(() => {
		const seconds = $currentTime ?? 0;
		const playing = $playerStore.isPlaying;
		const nextMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
		baseTimeMs = nextMs;
		if (browser) {
			lastBaseTimestamp = performance.now();
		}
		if (scriptStatus === 'ready' && amLyricsElement) {
			const current = Number(amLyricsElement.currentTime ?? 0);
			const delta = Math.abs(current - nextMs);
			if (!playing || delta > SEEK_FORCE_THRESHOLD_MS) {
				amLyricsElement.currentTime = nextMs;
			}
		}
	});

	$effect(() => {
		lyricsKey = `${$lyricsStore.refreshToken}:${$lyricsStore.track?.id ?? 'none'}`;
	});

	$effect(() => {
		if ($lyricsStore.open && browser) {
			void ensureComponentLoaded();
		}
		attachEscapeListener($lyricsStore.open);
	});

	onDestroy(() => {
		attachEscapeListener(false);
	});

	async function ensureComponentLoaded() {
		if (scriptStatus === 'ready') {
			return;
		}
		if (typeof customElements !== 'undefined' && customElements.get('am-lyrics')) {
			scriptStatus = 'ready';
			scriptError = null;
			return;
		}
		if (pendingLoad) {
			scriptStatus = 'loading';
			try {
				await pendingLoad;
			} catch {
				// handled when the original promise settles
			}
			return;
		}
		if (!browser) return;

		scriptStatus = 'loading';
		scriptError = null;

		pendingLoad = loadComponentScript()
			.then(() => {
				scriptStatus = 'ready';
				scriptError = null;
				if (amLyricsElement) {
					amLyricsElement.currentTime = baseTimeMs;
				}
			})
			.catch((error) => {
				console.error('Failed to load Apple Music lyrics component', error);
				scriptStatus = 'error';
				scriptError = error instanceof Error ? error.message : 'Unable to load lyrics component.';
			})
			.finally(() => {
				pendingLoad = null;
			});

		await pendingLoad;
	}

	function loadComponentScript(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!browser) {
				resolve();
				return;
			}

			const waitForDefinition = () => {
				if (typeof customElements !== 'undefined' && 'whenDefined' in customElements) {
					customElements
						.whenDefined('am-lyrics')
						.then(() => resolve())
						.catch(reject);
				} else {
					resolve();
				}
			};

			if (typeof customElements !== 'undefined' && customElements.get('am-lyrics')) {
				resolve();
				return;
			}

			const existing = document.querySelector<HTMLScriptElement>('script[data-am-lyrics]');
			if (existing) {
				if (existing.dataset.loaded === 'true') {
					waitForDefinition();
					return;
				}
				const handleLoad = () => {
					existing.dataset.loaded = 'true';
					waitForDefinition();
				};
				const handleError = () => {
					existing.removeEventListener('load', handleLoad);
					existing.removeEventListener('error', handleError);
					existing.remove();
					reject(new Error('Failed to load lyrics component.'));
				};
				existing.addEventListener('load', handleLoad, { once: true });
				existing.addEventListener('error', handleError, { once: true });
				return;
			}

			const script = document.createElement('script');
			script.type = 'module';
			script.src = COMPONENT_MODULE_URL;
			script.dataset.amLyrics = 'true';

			const handleLoad = () => {
				script.dataset.loaded = 'true';
				waitForDefinition();
			};

			const handleError = () => {
				script.removeEventListener('load', handleLoad);
				script.removeEventListener('error', handleError);
				script.remove();
				reject(new Error('Failed to load lyrics component.'));
			};

			script.addEventListener('load', handleLoad, { once: true });
			script.addEventListener('error', handleError, { once: true });
			document.head.append(script);
		});
	}

	function handleOverlayClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			lyricsStore.close();
		}
	}

	function handleOverlayKeydown(event: KeyboardEvent) {
		if (event.target !== event.currentTarget) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			lyricsStore.close();
		}
	}

	function handleEscape(event: KeyboardEvent) {
		if (event.key === 'Escape' && $lyricsStore.open) {
			event.preventDefault();
			lyricsStore.close();
		}
	}

	function attachEscapeListener(open: boolean) {
		if (!browser) return;
		if (open && !hasEscapeListener) {
			window.addEventListener('keydown', handleEscape);
			hasEscapeListener = true;
		} else if (!open && hasEscapeListener) {
			window.removeEventListener('keydown', handleEscape);
			hasEscapeListener = false;
		}
	}

	function stopAnimation() {
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	function handleRefresh() {
		if ($lyricsStore.track) {
			lyricsStore.refresh();
		}
		if (scriptStatus !== 'ready' && browser) {
			scriptStatus = 'idle';
			scriptError = null;
			void ensureComponentLoaded();
		}
	}

	function handleRetry() {
		scriptStatus = 'idle';
		scriptError = null;
		if (browser) {
			void ensureComponentLoaded();
		}
	}

	function handleLineClick(event: Event) {
		const detail = (event as CustomEvent<{ timestamp: number }>).detail;
		if (!detail) return;
		const timeSeconds = detail.timestamp / 1000;
		playerStore.play();
		window.dispatchEvent(new CustomEvent('lyrics:seek', { detail: { timeSeconds } }));
	}

	function patchLyricsAutoscroll(element: AmLyricsElement, attempt = 0) {
		if (!browser || !element || element.__tidalScrollPatched) {
			return;
		}

		const container = element.shadowRoot?.querySelector<HTMLElement>('.lyrics-container');
		if (!container) {
			if (attempt > 8) return;
			if (scrollPatchFrame !== null) {
				cancelAnimationFrame(scrollPatchFrame);
			}
			scrollPatchFrame = requestAnimationFrame(() => {
				patchLyricsAutoscroll(element, attempt + 1);
			});
			return;
		}

		scrollPatchFrame = null;

		element.__tidalScrollPatched = true;

		const styles = getComputedStyle(container);
		const parsedPaddingTop = parseFloat(styles.paddingTop || '0');
		const parsedPaddingBottom = parseFloat(styles.paddingBottom || '0');
		const preferredFraction = 0.32;
		const comfortTopFraction = 0.18;
		const comfortBottomFraction = 0.22;

		const computeScrollTarget = (line: HTMLElement) => {
			const containerRect = container.getBoundingClientRect();
			const lineRect = line.getBoundingClientRect();
			const lineTop = lineRect.top - containerRect.top + container.scrollTop;
			const lineBottom = lineTop + lineRect.height;
			const viewportStart = container.scrollTop;
			const viewportEnd = viewportStart + container.clientHeight;
			const comfortStart = viewportStart + parsedPaddingTop + container.clientHeight * comfortTopFraction;
			const comfortEnd = viewportEnd - parsedPaddingBottom - container.clientHeight * comfortBottomFraction;

			if (lineTop >= comfortStart && lineBottom <= comfortEnd) {
				return null;
			}

			const backgroundBefore = line.querySelector<HTMLElement>('.background-text.before');
			const backgroundOffset = backgroundBefore
				? Math.min(backgroundBefore.clientHeight / 2, lineRect.height * 0.6)
				: 0;

			const desiredTop =
				lineTop - parsedPaddingTop - container.clientHeight * preferredFraction - backgroundOffset;
			const maxScroll = container.scrollHeight - container.clientHeight;

			return Math.max(0, Math.min(maxScroll, desiredTop));
		};

		const applyScroll = (target: number | null) => {
			if (target === null) return;
			const delta = Math.abs(container.scrollTop - target);
			if (delta < 1) return;
			container.scrollTo({ top: target, behavior: 'smooth' });
		};

		const originalActiveScroll = element.scrollToActiveLine?.bind(element);
		element.scrollToActiveLine = function () {
			const indices = Array.isArray(element.activeLineIndices)
				? (element.activeLineIndices as number[])
				: [];
			if (!indices.length) {
				originalActiveScroll?.();
				return;
			}

			const targetIndex = Math.min(...indices);
			const line = container.querySelector<HTMLElement>(
				`.lyrics-line:nth-child(${targetIndex + 1})`
			);
			if (!line) {
				originalActiveScroll?.();
				return;
			}

			const target = computeScrollTarget(line);
			if (target === null) return;
			applyScroll(target);
		};

		const originalInstrumentalScroll = element.scrollToInstrumental?.bind(element);
		element.scrollToInstrumental = function (index: number) {
			const line = container.querySelector<HTMLElement>(`.lyrics-line:nth-child(${index + 1})`);
			if (!line) {
				originalInstrumentalScroll?.(index);
				return;
			}

			const target = computeScrollTarget(line);
			if (target === null) return;
			applyScroll(target);
		};
	}

	$effect(() => {
		if (!amLyricsElement) {
			return;
		}

		const listener = (event: Event) => handleLineClick(event);
		amLyricsElement.addEventListener('line-click', listener as EventListener);
		return () => {
			amLyricsElement?.removeEventListener('line-click', listener as EventListener);
		};
	});

	$effect(() => {
		if (!browser) return;
		const element = amLyricsElement as AmLyricsElement | null;
		if (!element || scriptStatus !== 'ready') return;
		patchLyricsAutoscroll(element);
	});

	$effect(() => {
		const open = $lyricsStore.open;
		const trackId = $lyricsStore.track?.id ?? null;

		if (!open || !trackId) {
			lastRefreshedTrackId = open ? trackId : null;
			return;
		}

		if (trackId !== lastRefreshedTrackId) {
			lastRefreshedTrackId = trackId;
			lyricsStore.refresh();
		}
	});

	$effect(() => {
		if (!browser || !amLyricsElement) {
			stopAnimation();
			return;
		}

		if (scriptStatus !== 'ready' || !$lyricsStore.open) {
			stopAnimation();
			amLyricsElement.currentTime = baseTimeMs;
			return;
		}

		if (!$playerStore.isPlaying) {
			stopAnimation();
			amLyricsElement.currentTime = baseTimeMs;
			return;
		}

		const element = amLyricsElement;
		const originBase = baseTimeMs;
		const nowTimestamp = performance.now();
		const originTimestamp =
			lastBaseTimestamp && Math.abs(nowTimestamp - lastBaseTimestamp) < 1200
				? lastBaseTimestamp
				: nowTimestamp;

		const tick = (now: number) => {
			const elapsed = now - originTimestamp;
			const nextMs = originBase + elapsed;
			element.currentTime = nextMs;
			animationFrameId = requestAnimationFrame(tick);
		};

		animationFrameId = requestAnimationFrame(tick);
		return () => {
			stopAnimation();
		};
	});

	$effect(() => {
		const track = $lyricsStore.track;
		if (!track) {
			metadata = null;
			return;
		}

		let title: string;
		let artist: string;
		let album: string | undefined;
		let isrc: string | undefined;

		if (isSonglinkTrack(track)) {
			title = track.title;
			artist = track.artistName;
			album = undefined;
			isrc = undefined;
		} else {
			title = track.title;
			artist = formatArtists(track.artists);
			album = track.album?.title;
			isrc = track.isrc;
		}

		const durationMs =
			typeof track.duration === 'number'
				? Math.max(0, Math.round(track.duration * 1000))
				: undefined;

		metadata = {
			title,
			artist,
			album,
			query: `${title} ${artist}`.trim(),
			durationMs,
			isrc: isrc ?? ''
		};
	});
</script>

{#if $lyricsStore.open}
	<div
		class="lyrics-overlay"
		role="presentation"
		onclick={handleOverlayClick}
		onkeydown={handleOverlayKeydown}
		tabindex="-1"
	>
		<div
			class={`lyrics-panel ${$lyricsStore.maximized ? 'lyrics-panel--maximized' : ''}`}
			role="dialog"
			aria-modal="true"
			aria-label="Lyrics"
		>
			<header class="lyrics-header">
				<div class="lyrics-heading">
					<h2 class="lyrics-title">Lyrics</h2>
					{#if metadata}
						<p class="lyrics-subtitle">{metadata.title} • {metadata.artist}</p>
						{#if metadata.album}
							<p class="lyrics-album">{metadata.album}</p>
						{/if}
					{:else}
						<p class="lyrics-subtitle">Start playback to load synced lyrics.</p>
					{/if}
				</div>
				<div class="lyrics-header-actions">
					<button
						type="button"
						class="lyrics-icon-button"
						onclick={handleRefresh}
						aria-label="Refresh lyrics"
						title="Refresh lyrics"
						disabled={!metadata || scriptStatus === 'loading'}
					>
						<RefreshCw size={18} class={scriptStatus === 'loading' ? 'animate-spin' : ''} />
					</button>
					<button
						type="button"
						class="lyrics-icon-button lyrics-maximize-button"
						onclick={() => lyricsStore.toggleMaximize()}
						aria-label={$lyricsStore.maximized ? 'Restore window' : 'Maximize window'}
						title={$lyricsStore.maximized ? 'Restore window' : 'Maximize window'}
					>
						{#if $lyricsStore.maximized}
							<Minimize2 size={18} />
						{:else}
							<Maximize2 size={18} />
						{/if}
					</button>
					<button
						type="button"
						class="lyrics-icon-button"
						onclick={() => lyricsStore.close()}
						aria-label="Close lyrics"
						title="Close lyrics"
					>
						<X size={18} />
					</button>
				</div>
			</header>

			<div class="lyrics-body">
				{#if scriptStatus === 'error'}
					<div class="lyrics-placeholder">
						<p class="lyrics-message">{scriptError ?? 'Unable to load lyrics right now.'}</p>
						<button type="button" class="lyrics-retry" onclick={handleRetry}> Try again </button>
					</div>
				{:else if !metadata}
					<div class="lyrics-placeholder">
						<p class="lyrics-message">Press play to fetch lyrics.</p>
					</div>
				{:else if scriptStatus === 'loading' || scriptStatus === 'idle'}
					<div class="lyrics-placeholder">
						<span class="spinner" aria-hidden="true"></span>
						Loading lyrics…
					</div>
				{:else}
					<div class="lyrics-component-wrapper">
						{#key lyricsKey}
							<am-lyrics
								bind:this={amLyricsElement}
								class="am-lyrics-element"
								song-title={metadata.title}
								song-artist={metadata.artist}
								song-album={metadata.album || undefined}
								song-duration={metadata.durationMs}
								query={metadata.query}
								isrc={metadata.isrc || undefined}
								highlight-color="#93c5fd"
								hover-background-color="rgba(59, 130, 246, 0.14)"
								font-family="'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif"
								autoscroll
								interpolate
							></am-lyrics>
						{/key}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.lyrics-overlay {
		position: fixed;
		inset: 0;
		bottom: var(--player-height, 120px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		padding-bottom: 0.5rem;
		background: transparent;
		backdrop-filter: blur(var(--perf-blur-low, 12px)) saturate(120%);
		-webkit-backdrop-filter: blur(var(--perf-blur-low, 12px)) saturate(120%);
		z-index: 60;
		pointer-events: none;
	}

	.lyrics-panel {
		width: min(960px, 100%);
		height: clamp(380px, 72vh, 780px);
		display: flex;
		flex-direction: column;
		border-radius: 1.25rem;
		background: transparent;
		border: 1px solid rgba(148, 163, 184, 0.25);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow: 
			0 30px 80px rgba(2, 6, 23, 0.6),
			0 4px 18px rgba(15, 23, 42, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		overflow: hidden;
		pointer-events: auto;
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.lyrics-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 1rem;
		border-bottom: 1px solid rgba(71, 85, 105, 0.45);
	}

	.lyrics-heading {
		flex: 1;
	}

	.lyrics-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: #f8fafc;
	}

	.lyrics-subtitle {
		margin: 0.35rem 0 0;
		font-size: 0.95rem;
		color: #cbd5f5;
	}

	.lyrics-album {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: #94a3b8;
	}

	.lyrics-header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.lyrics-icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem;
		border-radius: 9999px;
		border: 1px solid rgba(148, 163, 184, 0.3);
		background: transparent;
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		color: #e2e8f0;
		transition:
			background 160ms ease,
			border-color 160ms ease,
			transform 160ms ease,
			box-shadow 160ms ease;
	}

	.lyrics-icon-button[disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.lyrics-icon-button:not([disabled]):hover {
		border-color: var(--bloom-accent, rgba(96, 165, 250, 0.7));
		box-shadow: inset 0 0 20px rgba(96, 165, 250, 0.12);
		transform: translateY(-1px);
	}

	.animate-spin {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.lyrics-body {
		flex: 1;
		padding: 1rem 1.5rem 1.5rem;
		display: flex;
		overflow: hidden;
	}

	.lyrics-component-wrapper {
		flex: 1;
		display: flex;
		align-items: stretch;
		justify-content: stretch;
		border-radius: 1rem;
		background: rgba(15, 23, 42, 0.65);
		border: 1px solid rgba(59, 73, 99, 0.5);
		overflow: hidden;
	}

	.am-lyrics-element {
		flex: 1;
		display: block;
		width: 100%;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		color: inherit;
	}

	.am-lyrics-element::part(container) {
		padding: 1.25rem;
		padding-block: 2rem;
		box-sizing: border-box;
	}

	.am-lyrics-element::part(line) {
		scroll-margin-block-start: min(32vh, 9rem);
		scroll-margin-block-end: min(28vh, 7rem);
	}

	@media (min-width: 640px) {
		.lyrics-panel--maximized .am-lyrics-element {
			font-size: clamp(1.05rem, 0.85rem + 1.2vw, 1.85rem);
			line-height: 1.6;
			letter-spacing: 0.01em;
		}

		.lyrics-panel--maximized .am-lyrics-element::part(line) {
			padding-block: clamp(0.65rem, 0.45rem + 0.8vw, 1.2rem);
		}
	}

	.lyrics-placeholder {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		text-align: center;
		color: #cbd5f5;
		padding: 1.5rem;
	}

	.lyrics-message {
		margin: 0;
		font-size: 0.95rem;
	}

	.lyrics-retry {
		border: 1px solid var(--bloom-accent, rgba(96, 165, 250, 0.7));
		background: transparent;
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		color: #f0f9ff;
		border-radius: 9999px;
		padding: 0.45rem 1.25rem;
		font-size: 0.85rem;
		font-weight: 500;
		box-shadow: inset 0 0 20px rgba(96, 165, 250, 0.1);
		transition:
			border-color 160ms ease,
			box-shadow 160ms ease;
	}

	.lyrics-retry:hover {
		border-color: var(--bloom-accent, rgba(191, 219, 254, 0.9));
		box-shadow: inset 0 0 30px rgba(96, 165, 250, 0.18);
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		border: 2px solid rgba(148, 163, 184, 0.35);
		border-top-color: rgba(148, 163, 184, 0.95);
		animation: spin 0.85s linear infinite;
	}

	@media (max-width: 640px) {
		.lyrics-overlay {
			padding: 0;
			align-items: stretch;
			justify-content: stretch;
			bottom: 0; /* Override player height on mobile for full screen */
		}

		.lyrics-panel {
			border-radius: 0;
			border: none;
			width: 100vw;
			height: 100vh;
			max-height: 100vh;
		}

		.lyrics-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.lyrics-header-actions {
			align-self: flex-end;
		}

		.lyrics-body {
			padding: 1rem;
		}

		.lyrics-maximize-button {
			display: none;
		}

		.am-lyrics-element::part(container) {
			padding: 1.5rem;
			padding-block: 2.5rem;
		}

		.am-lyrics-element::part(line) {
			scroll-margin-block-start: min(40vh, 9rem);
			scroll-margin-block-end: min(28vh, 6.5rem);
		}
	}
</style>
