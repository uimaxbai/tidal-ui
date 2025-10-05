<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { currentTime, playerStore } from '$lib/stores/player';
	import { lyricsStore } from '$lib/stores/lyrics';
	import { Maximize2, Minimize2, RefreshCw, X } from 'lucide-svelte';

	const COMPONENT_MODULE_URL =
		'https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics@0.5.2/dist/src/am-lyrics.min.js';

		type LyricsMetadata = {
			title: string;
			artist: string;
			album?: string;
			query: string;
			durationMs?: number;
			isrc?: string;
		};

	let amLyricsElement = $state<HTMLElement & { currentTime: number } | null>(null);
	let scriptStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let scriptError = $state<string | null>(null);
	let pendingLoad: Promise<void> | null = null;
	let hasEscapeListener = false;

	let playbackTimeMs = $state(0);
	let lyricsKey = $state('0:none');
		let metadata = $state<LyricsMetadata | null>(null);

	$effect(() => {
		playbackTimeMs = Math.max(0, ($currentTime ?? 0) * 1000);
		if (scriptStatus === 'ready' && amLyricsElement) {
			amLyricsElement.currentTime = playbackTimeMs;
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
					amLyricsElement.currentTime = playbackTimeMs;
				}
			})
			.catch((error) => {
				console.error('Failed to load Apple Music lyrics component', error);
				scriptStatus = 'error';
				scriptError =
					error instanceof Error ? error.message : 'Unable to load lyrics component.';
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
		const track = $lyricsStore.track;
		if (!track) {
			metadata = null;
			return;
		}

		const title = track.title;
		const artist = track.artist?.name ?? '';
		const album = track.album?.title;
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
			isrc: track.isrc ?? ''
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
						class="lyrics-icon-button"
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
						<button type="button" class="lyrics-retry" onclick={handleRetry}>
							Try again
						</button>
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
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(9, 12, 19, 0.75);
		backdrop-filter: blur(6px);
		z-index: 60;
	}

	.lyrics-panel {
		width: min(960px, 100%);
		height: clamp(380px, 72vh, 780px);
		display: flex;
		flex-direction: column;
		border-radius: 1.25rem;
		background: rgba(15, 23, 42, 0.92);
		border: 1px solid rgba(59, 73, 99, 0.6);
		box-shadow: 0 30px 60px rgba(2, 6, 23, 0.55);
		overflow: hidden;
		transition:
			width 180ms ease,
			height 180ms ease;
	}

	.lyrics-panel--maximized {
		width: min(1200px, 98vw);
		height: min(900px, 92vh);
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
		border: 1px solid rgba(71, 85, 105, 0.55);
		background: rgba(30, 41, 59, 0.7);
		color: #e2e8f0;
		transition:
			background 160ms ease,
			border-color 160ms ease,
			transform 160ms ease;
	}

	.lyrics-icon-button[disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.lyrics-icon-button:not([disabled]):hover {
		background: rgba(56, 189, 248, 0.18);
		border-color: rgba(96, 165, 250, 0.6);
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
		color: inherit;
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
		border: 1px solid rgba(96, 165, 250, 0.6);
		background: rgba(56, 189, 248, 0.2);
		color: #f0f9ff;
		border-radius: 9999px;
		padding: 0.45rem 1.25rem;
		font-size: 0.85rem;
		font-weight: 500;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}

	.lyrics-retry:hover {
		background: rgba(96, 165, 250, 0.3);
		border-color: rgba(191, 219, 254, 0.8);
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
		.lyrics-panel {
			border-radius: 1rem;
			height: 88vh;
		}

		.lyrics-panel--maximized {
			width: 100%;
			height: 94vh;
		}

		.lyrics-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.lyrics-header-actions {
			align-self: flex-end;
		}
	}
</style>
