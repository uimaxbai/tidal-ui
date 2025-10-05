<script lang="ts">
	import { browser } from '$app/environment';
	import { derived } from 'svelte/store';
	import { currentTime } from '$lib/stores/player';
	import { lyricsStore } from '$lib/stores/lyrics';
	import type { LyricsLine, LyricsSyllable } from '$lib/lyrics/youly';
	import { Maximize2, Minimize2, RefreshCw, X } from 'lucide-svelte';

	const activeLine = derived([lyricsStore, currentTime], ([state, time]) => {
		if (!state.data || state.status !== 'ready') {
			return -1;
		}

		const lines = state.data.lines;
		const playback = time ?? 0;
		let matchedIndex = -1;
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]!;
			const start = line.startTime ?? 0;
			const endCandidate =
				Number.isFinite(line.endTime) && line.endTime > start
					? line.endTime
					: line.duration && line.duration > 0
						? start + line.duration
						: start + 5;
			const end = endCandidate + 0.2;
			if (playback >= start && playback <= end) {
				matchedIndex = index;
				break;
			}
		}

		if (matchedIndex === -1 && playback > lines[lines.length - 1]?.startTime) {
			matchedIndex = lines.length - 1;
		}

		return matchedIndex;
	});

	let scrollContainer = $state<HTMLDivElement | null>(null);
	let hasEscapeListener = false;
	let lastScrolledIndex = -1;
	let playbackPosition = $state(0);

	$effect(() => {
		playbackPosition = $currentTime ?? 0;
	});

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

	$effect(() => {
		attachEscapeListener($lyricsStore.open);
	});

	$effect(() => {
		if (!$lyricsStore.open) {
			lastScrolledIndex = -1;
		}
	});

	$effect(() => {
		if (
			scrollContainer &&
			$lyricsStore.open &&
			$lyricsStore.status === 'ready' &&
			$activeLine >= 0 &&
			$activeLine !== lastScrolledIndex
		) {
			const element = scrollContainer.querySelector<HTMLElement>(
				`[data-line-index="${$activeLine}"]`
			);
			if (element) {
				element.scrollIntoView({
					behavior: lastScrolledIndex === -1 ? 'auto' : 'smooth',
					block: 'center'
				});
				lastScrolledIndex = $activeLine;
			}
		}
	});

	const showRomanizedLine = (text?: string, fallback?: string) => {
		if (!text) return false;
		if (!fallback) return true;
		return text.trim().toLowerCase() !== fallback.trim().toLowerCase();
	};

	const KARAOKE_SLOP_SECONDS = 0.12;

	type WordState = {
		progress: number;
		status: 'pending' | 'active' | 'done';
	};

	type WordRender = {
		index: number;
		text: string;
		className: string;
		width: string;
	};

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function resolveSyllableTiming(lineStart: number, syllableStart?: number): number {
		if (typeof syllableStart === 'number' && Number.isFinite(syllableStart)) {
			return syllableStart;
		}
		return lineStart;
	}

	function resolveSyllableDuration(
		syllaDuration: number | undefined,
		lineDuration: number | undefined,
		totalSyllables: number
	): number {
		if (typeof syllaDuration === 'number' && Number.isFinite(syllaDuration) && syllaDuration > 0) {
			return syllaDuration;
		}
		if (
			typeof lineDuration === 'number' &&
			Number.isFinite(lineDuration) &&
			lineDuration > 0 &&
			totalSyllables > 0
		) {
			return lineDuration / totalSyllables;
		}
		return 0;
	}

	function getWordState(
		line: LyricsLine,
		syllable: LyricsSyllable,
		playbackTime: number
	): WordState {
		const lineStart = line.startTime ?? 0;
		const syllableStart = resolveSyllableTiming(lineStart, syllable.startTime);
		const duration = resolveSyllableDuration(
			syllable.duration,
			line.duration,
			line.syllables?.length ?? 0
		);
		const syllableEnd = duration > 0 ? syllableStart + duration : syllableStart;
		const effectiveEnd = syllableEnd + KARAOKE_SLOP_SECONDS;

		if (playbackTime >= effectiveEnd) {
			return { status: 'done', progress: 1 };
		}

		if (playbackTime < syllableStart - KARAOKE_SLOP_SECONDS) {
			return { status: 'pending', progress: 0 };
		}

		if (duration <= 0) {
			return { status: 'active', progress: 1 };
		}

		const rawProgress = (playbackTime - syllableStart) / duration;
		return {
			status: 'active',
			progress: clamp(rawProgress, 0, 1)
		};
	}

	function buildWordRender(line: LyricsLine, playbackTime: number): WordRender[] {
		if (!line.syllables?.length) {
			return [];
		}

		return line.syllables.map((syllable, index) => {
			const state = getWordState(line, syllable, playbackTime);
			const className = `lyrics-word lyrics-word--${state.status}${
				syllable.isBackground ? ' lyrics-word--background' : ''
			}`;
			const width = state.status === 'done' ? '100%' : `${(state.progress * 100).toFixed(4)}%`;
			return {
				index,
				text: syllable.text ?? '',
				className,
				width
			};
		});
	}
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
					{#if $lyricsStore.track}
						<p class="lyrics-subtitle">
							{$lyricsStore.track.title} • {$lyricsStore.track.artist?.name}
						</p>
					{:else}
						<p class="lyrics-subtitle">Start playback to load synced lyrics.</p>
					{/if}
					{#if $lyricsStore.data?.metadata?.source}
						<p class="lyrics-source">Source: {$lyricsStore.data.metadata.source}</p>
					{/if}
				</div>
				<div class="lyrics-header-actions">
					<button
						type="button"
						class="lyrics-icon-button"
						onclick={() => lyricsStore.refresh()}
						aria-label="Refresh lyrics"
						title="Refresh lyrics"
						disabled={$lyricsStore.status === 'loading'}
					>
						<RefreshCw size={18} class={$lyricsStore.status === 'loading' ? 'animate-spin' : ''} />
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
				{#if $lyricsStore.status === 'loading'}
					<div class="lyrics-placeholder">
						<span class="spinner" aria-hidden="true"></span>
						Loading lyrics…
					</div>
				{:else if $lyricsStore.status === 'error'}
					<div class="lyrics-placeholder">
						<p class="lyrics-message">{$lyricsStore.error ?? 'Unable to load lyrics right now.'}</p>
						<button type="button" class="lyrics-retry" onclick={() => lyricsStore.refresh()}>
							Try again
						</button>
					</div>
				{:else if $lyricsStore.status === 'not-found'}
					<div class="lyrics-placeholder">
						<p class="lyrics-message">No synced lyrics were found for this track.</p>
					</div>
				{:else if $lyricsStore.status === 'ready' && $lyricsStore.data}
					<div class="lyrics-scroll" bind:this={scrollContainer}>
						{#each $lyricsStore.data.lines as line, index}
							<div
								class={`lyrics-line ${$activeLine === index ? 'lyrics-line--active' : ''}`}
								data-line-index={index}
							>
								<p class="lyrics-line-text">
									{#if ($lyricsStore.data.kind === 'word' || line.syllables?.length) && line.syllables?.length}
										<span class="lyrics-line-words">
											{#each buildWordRender(line, playbackPosition) as word (word.index)}
												<span class={word.className} data-syllable-index={word.index}>
													<span
														class="lyrics-word-highlight"
														aria-hidden="true"
														style={`width: ${word.width}`}
													>
														{word.text}
													</span>
													<span class="lyrics-word-base">{word.text}</span>
												</span>
											{/each}
										</span>
									{:else}
										{line.text}
									{/if}
								</p>
								{#if showRomanizedLine(line.romanizedText, line.text)}
									<p class="lyrics-line-romanized">{line.romanizedText}</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="lyrics-placeholder">
						<p class="lyrics-message">Press play to fetch lyrics.</p>
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

	.lyrics-source {
		margin: 0.35rem 0 0;
		font-size: 0.75rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.12em;
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

	.lyrics-scroll {
		flex: 1;
		overflow-y: auto;
		padding-right: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.lyrics-line {
		padding: 0.65rem 0.85rem;
		border-radius: 0.9rem;
		background: transparent;
		transition:
			background 160ms ease,
			transform 160ms ease;
		color: #e2e8f0;
	}

	.lyrics-line:hover {
		background: rgba(59, 130, 246, 0.08);
	}

	.lyrics-line--active {
		background: rgba(59, 130, 246, 0.18);
		color: #ffffff;
		transform: translateY(-2px);
		box-shadow: 0 12px 20px rgba(15, 118, 230, 0.18);
	}

	.lyrics-line-text {
		margin: 0;
		font-size: clamp(1.2rem, 2.2vw, 1.45rem);
		font-weight: 600;
		letter-spacing: 0.015em;
		line-height: 1.8;
		white-space: pre-wrap;
	}

	.lyrics-line-words {
		display: inline;
		position: relative;
	}

	.lyrics-word {
		position: relative;
		display: inline;
		white-space: pre;
		line-height: inherit;
		font-weight: inherit;
		color: rgba(148, 163, 184, 0.55);
	}

	.lyrics-word-base {
		display: inline;
		white-space: pre;
		opacity: 1;
		transition:
			opacity 220ms ease,
			color 220ms ease;
	}

	.lyrics-word-highlight {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 100%;
		display: inline-flex;
		align-items: baseline;
		justify-content: flex-start;
		overflow: hidden;
		white-space: pre;
		color: #b9d8ff;
		text-shadow: 0 0 9px rgba(96, 165, 250, 0.55);
		pointer-events: none;
		transition: width 260ms linear;
		will-change: width;
	}

	.lyrics-word--active .lyrics-word-highlight,
	.lyrics-word--done .lyrics-word-highlight {
		color: #f8fbff;
	}

	.lyrics-word--active .lyrics-word-base,
	.lyrics-word--done .lyrics-word-base {
		color: rgba(248, 251, 255, 0.85);
	}

	.lyrics-word--done .lyrics-word-highlight {
		width: 100% !important;
	}

	.lyrics-word--background .lyrics-word-base {
		color: rgba(148, 163, 184, 0.35);
	}

	.lyrics-word--background .lyrics-word-highlight {
		color: rgba(200, 210, 230, 0.8);
		text-shadow: 0 0 6px rgba(148, 163, 184, 0.45);
	}

	.lyrics-line-romanized {
		margin: 0.3rem 0 0;
		font-size: 0.85rem;
		color: #cbd5f5;
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
