<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { fade } from 'svelte/transition';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import LyricsPopup from '$lib/components/LyricsPopup.svelte';
	import DynamicBackground from '$lib/components/DynamicBackground.svelte';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadPreferencesStore, type DownloadMode } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import { sanitizeForFilename, getExtensionForQuality, buildTrackLinksCsv } from '$lib/downloads';
	import { navigating } from '$app/stores';
	import JSZip from 'jszip';
	import {
		Archive,
		FileSpreadsheet,
		ChevronDown,
		LoaderCircle,
		Download,
		Check,
		Settings
	} from 'lucide-svelte';
	import type { Navigation } from '@sveltejs/kit';
	import type { Track, AudioQuality } from '$lib/types';

	let { children, data } = $props();
	const pageTitle = $derived(data?.title ?? 'BiniTidal');
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let viewportHeight = $state(0);
	let navigationState = $state<Navigation | null>(null);
	let showSettingsMenu = $state(false);
	let isZipDownloading = $state(false);
	let isCsvExporting = $state(false);
	let isLegacyQueueDownloading = $state(false);
	let settingsMenuContainer: HTMLDivElement | null = null;
	const downloadMode = $derived($downloadPreferencesStore.mode);
	const queueActionBusy = $derived(
		downloadMode === 'zip'
				? Boolean(isZipDownloading || isLegacyQueueDownloading || isCsvExporting)
				: downloadMode === 'csv'
				? Boolean(isCsvExporting)
				: Boolean(isLegacyQueueDownloading)
	);
	const mainMinHeight = $derived(() => Math.max(0, viewportHeight - headerHeight - playerHeight));
	const contentPaddingBottom = $derived(() => Math.max(playerHeight, 24));
	const mainMarginBottom = $derived(() => Math.max(playerHeight, 128));
	const settingsMenuOffset = $derived(() => Math.max(0, headerHeight + 12));
	const FRIENDLY_ROUTE_MESSAGES: Record<string, string> = {
		album: 'Opening album',
		artist: 'Visiting artist',
		playlist: 'Loading playlist'
	};

	const QUALITY_OPTIONS: Array<{ value: AudioQuality; label: string; description: string }> = [
		{
			value: 'HI_RES_LOSSLESS',
			label: 'Hi-Res',
			description: '24-bit FLAC (DASH) up to 192 kHz'
		},
		{
			value: 'LOSSLESS',
			label: 'CD Lossless',
			description: '16-bit / 44.1 kHz FLAC'
		},
		{
			value: 'HIGH',
			label: '320kbps AAC',
			description: 'High quality AAC streaming'
		},
		{
			value: 'LOW',
			label: '96kbps AAC',
			description: 'Data saver AAC streaming'
		}
	];

	const playbackQualityLabel = $derived(() => {
		const quality = $playerStore.quality;
		if (quality === 'HI_RES_LOSSLESS') {
			return 'Hi-Res';
		}
		if (quality === 'LOSSLESS') {
			return 'CD';
		}
		return QUALITY_OPTIONS.find((option) => option.value === quality)?.label ?? 'Quality';
	});

	const convertAacToMp3 = $derived($userPreferencesStore.convertAacToMp3);

	function selectPlaybackQuality(quality: AudioQuality): void {
		playerStore.setQuality(quality);
		showSettingsMenu = false;
	}

	function toggleAacConversion(): void {
		userPreferencesStore.toggleConvertAacToMp3();
	}

	function setDownloadMode(mode: DownloadMode): void {
		downloadPreferencesStore.setMode(mode);
	}

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

	function collectQueueState(): { tracks: Track[]; quality: AudioQuality } {
		const state = get(playerStore);
		const tracks = state.queue.length
			? state.queue
			: state.currentTrack
				? [state.currentTrack]
				: [];
		return { tracks, quality: state.quality };
	}

	function buildQueueFilename(track: Track, index: number, quality: AudioQuality): string {
		const ext = getExtensionForQuality(quality, convertAacToMp3);
		const order = `${index + 1}`.padStart(2, '0');
		const artistName = sanitizeForFilename(track.artist?.name ?? 'Unknown Artist');
		const titleName = sanitizeForFilename(track.title ?? `Track ${order}`);
		return `${order} - ${artistName} - ${titleName}.${ext}`;
	}

	function triggerFileDownload(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	function timestampedFilename(extension: string): string {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		return `tidal-export-${stamp}.${extension}`;
	}

	async function downloadQueueAsZip(tracks: Track[], quality: AudioQuality): Promise<void> {
		isZipDownloading = true;

		try {
			const zip = new JSZip();
			for (const [index, track] of tracks.entries()) {
				const filename = buildQueueFilename(track, index, quality);
				const { blob } = await losslessAPI.fetchTrackBlob(track.id, quality, filename, {
					ffmpegAutoTriggered: false,
					convertAacToMp3
				});
				zip.file(filename, blob);
			}

			const zipBlob = await zip.generateAsync({
				type: 'blob',
				compression: 'DEFLATE',
				compressionOptions: { level: 6 }
			});

			triggerFileDownload(zipBlob, timestampedFilename('zip'));
		} catch (error) {
			console.error('Failed to build ZIP export', error);
			alert('Unable to build ZIP export. Please try again.');
		} finally {
			isZipDownloading = false;
		}
	}

	async function exportQueueAsCsv(tracks: Track[], quality: AudioQuality): Promise<void> {
		isCsvExporting = true;

		try {
			const csvContent = await buildTrackLinksCsv(tracks, quality);
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			triggerFileDownload(blob, timestampedFilename('csv'));
		} catch (error) {
			console.error('Failed to export queue as CSV', error);
			alert('Unable to export CSV. Please try again.');
		} finally {
			isCsvExporting = false;
		}
	}

	async function handleExportQueueCsv(): Promise<void> {
		const { tracks, quality } = collectQueueState();
		if (tracks.length === 0) {
			showSettingsMenu = false;
			alert('Add tracks to the queue before exporting.');
			return;
		}

		showSettingsMenu = false;
		await exportQueueAsCsv(tracks, quality);
	}

	async function downloadQueueIndividually(tracks: Track[], quality: AudioQuality): Promise<void> {
		if (isLegacyQueueDownloading) {
			return;
		}

		isLegacyQueueDownloading = true;
		const errors: string[] = [];

		try {
			for (const [index, track] of tracks.entries()) {
				const filename = buildQueueFilename(track, index, quality);
				const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
					subtitle: track.album?.title ?? track.artist?.name
				});
				downloadUiStore.skipFfmpegCountdown();

				try {
					await losslessAPI.downloadTrack(track.id, quality, filename, {
						signal: controller.signal,
						onProgress: (progress: TrackDownloadProgress) => {
							if (progress.stage === 'downloading') {
								downloadUiStore.updateTrackProgress(
									taskId,
									progress.receivedBytes,
									progress.totalBytes
								);
							} else {
								downloadUiStore.updateTrackStage(taskId, progress.progress);
							}
						},
						onFfmpegCountdown: ({ totalBytes }) => {
							const bytes = typeof totalBytes === 'number' ? totalBytes : 0;
							downloadUiStore.startFfmpegCountdown(bytes, { autoTriggered: false });
						},
						onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
						onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
						onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
						onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
						ffmpegAutoTriggered: false,
						convertAacToMp3
					});
					downloadUiStore.completeTrackDownload(taskId);
				} catch (error) {
					if (error instanceof DOMException && error.name === 'AbortError') {
						downloadUiStore.completeTrackDownload(taskId);
						continue;
					}
					console.error('Failed to download track from queue:', error);
					downloadUiStore.errorTrackDownload(taskId, error);
					const label = `${track.artist?.name ?? 'Unknown Artist'} - ${track.title ?? 'Unknown Track'}`;
					const message =
						error instanceof Error && error.message
							? error.message
							: 'Failed to download track. Please try again.';
					errors.push(`${label}: ${message}`);
				}
			}

			if (errors.length > 0) {
				const summary = [
					'Unable to download some tracks individually:',
					...errors.slice(0, 3),
					errors.length > 3 ? `…and ${errors.length - 3} more` : undefined
				]
					.filter(Boolean)
					.join('\n');
				alert(summary);
			}
		} finally {
			isLegacyQueueDownloading = false;
		}
	}

	async function handleQueueDownload(): Promise<void> {
		if (queueActionBusy) {
			return;
		}

		const { tracks, quality } = collectQueueState();
		if (tracks.length === 0) {
			showSettingsMenu = false;
			alert('Add tracks to the queue before downloading.');
			return;
		}

		showSettingsMenu = false;

		if (downloadMode === 'csv') {
			await exportQueueAsCsv(tracks, quality);
			return;
		}

		const useZip = downloadMode === 'zip' && tracks.length > 1;
		if (useZip) {
			await downloadQueueAsZip(tracks, quality);
			return;
		}

		await downloadQueueIndividually(tracks, quality);
	}

	const handlePlayerHeight = (height: number) => {
		playerHeight = height;
	};

	let controllerChangeHandler: (() => void) | null = null;

	onMount(() => {
		const updateViewportHeight = () => {
			viewportHeight = window.innerHeight;
		};
		updateViewportHeight();
		window.addEventListener('resize', updateViewportHeight);
		const handleDocumentClick = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (showSettingsMenu) {
				const root = settingsMenuContainer;
				if (!root || !target || !root.contains(target)) {
					showSettingsMenu = false;
				}
			}
		};
		document.addEventListener('click', handleDocumentClick);
		const unsubscribe = navigating.subscribe((value) => {
			navigationState = value;
		});

		if ('serviceWorker' in navigator) {
			const registerServiceWorker = async () => {
				try {
					const registration = await navigator.serviceWorker.register('/service-worker.js');
					const sendSkipWaiting = () => {
						if (registration.waiting) {
							registration.waiting.postMessage({ type: 'SKIP_WAITING' });
						}
					};

					if (registration.waiting) {
						sendSkipWaiting();
					}

					registration.addEventListener('updatefound', () => {
						const newWorker = registration.installing;
						if (!newWorker) return;
						newWorker.addEventListener('statechange', () => {
							if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
								sendSkipWaiting();
							}
						});
					});
				} catch (error) {
					console.error('Service worker registration failed', error);
				}
			};

			registerServiceWorker();

			let refreshing = false;
			controllerChangeHandler = () => {
				if (refreshing) return;
				refreshing = true;
				window.location.reload();
			};
			navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);
		}
		return () => {
			window.removeEventListener('resize', updateViewportHeight);
			document.removeEventListener('click', handleDocumentClick);
			unsubscribe();
			if (controllerChangeHandler) {
				navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);
			}
		};
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
	<meta name="theme-color" content="#0f172a" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&family=Host+Grotesk:ital,wght@0,300..800;1,300..800&family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="app-root">
	<DynamicBackground />
	<div class="app-shell">
		<header class="app-header glass-panel" bind:clientHeight={headerHeight}>
			<div class="app-header__inner">
				<a href="/" class="brand" aria-label="Home">
					<div class="brand__text">
						<h1 class="brand__title">{data.title}</h1>
						<p class="brand__subtitle">sailing on PCM tidal waves</p>
					</div>
				</a>

				<div class="toolbar">
					<div class="settings-trigger" bind:this={settingsMenuContainer}>
						<button
							onclick={() => {
								showSettingsMenu = !showSettingsMenu;
							}}
							type="button"
							class={`toolbar-button glass-button ${showSettingsMenu ? 'is-active' : ''}`}
							aria-haspopup="true"
							aria-expanded={showSettingsMenu}
							aria-label={`Settings menu (${playbackQualityLabel()})`}
						>
							<span class="toolbar-button__label">
								<Settings size={16} />
								<span class="toolbar-button__text">Settings</span>
							</span>
							<span class="text-gray-400">{playbackQualityLabel()}</span>
							<span class={`toolbar-button__chevron ${showSettingsMenu ? 'is-open' : ''}`}>
								<ChevronDown size={16} />
							</span>
						</button>
						{#if showSettingsMenu}
							<div
								class="settings-menu glass-popover"
								style={`--settings-menu-offset: ${settingsMenuOffset()}px;`}
							>
								<div class="settings-grid">
									<section class="settings-section settings-section--wide">
										<p class="section-heading">Streaming & Downloads</p>
										<div class="option-grid">
											{#each QUALITY_OPTIONS as option}
												<button
													type="button"
													onclick={() => selectPlaybackQuality(option.value)}
													class={`glass-option ${option.value === $playerStore.quality ? 'is-active' : ''}`}
													aria-pressed={option.value === $playerStore.quality}
												>
													<div class="glass-option__content">
														<span class="glass-option__label">{option.label}</span>
														<span class="glass-option__description">{option.description}</span>
													</div>
													{#if option.value === $playerStore.quality}
														<Check size={16} class="glass-option__check" />
													{/if}
												</button>
											{/each}
										</div>
									</section>
									<section class="settings-section">
										<p class="section-heading">Conversions</p>
										<button
											type="button"
											onclick={toggleAacConversion}
											class={`glass-option ${convertAacToMp3 ? 'is-active' : ''}`}
											aria-pressed={convertAacToMp3}
										>
											<span class="glass-option__content">
												<span class="glass-option__label">Convert AAC downloads to MP3</span>
												<span class="glass-option__description">Applies to 320kbps and 96kbps downloads.</span>
											</span>
											<span class={`glass-option__chip ${convertAacToMp3 ? 'is-active' : ''}`}>
												{convertAacToMp3 ? 'On' : 'Off'}
											</span>
										</button>
									</section>
									<section class="settings-section">
										<p class="section-heading">Queue exports</p>
										<div class="option-grid">
											<button
												type="button"
												onclick={() => setDownloadMode('individual')}
												class={`glass-option ${downloadMode === 'individual' ? 'is-active' : ''}`}
												aria-pressed={downloadMode === 'individual'}
											>
												<span class="glass-option__content">
													<span class="glass-option__label">
														<Download size={16} />
														<span>Individual files</span>
													</span>
												</span>
												{#if downloadMode === 'individual'}
													<Check size={14} class="glass-option__check" />
												{/if}
											</button>
											<button
												type="button"
												onclick={() => setDownloadMode('zip')}
												class={`glass-option ${downloadMode === 'zip' ? 'is-active' : ''}`}
												aria-pressed={downloadMode === 'zip'}
											>
												<span class="glass-option__content">
													<span class="glass-option__label">
														<Archive size={16} />
														<span>ZIP archive</span>
													</span>
												</span>
												{#if downloadMode === 'zip'}
													<Check size={14} class="glass-option__check" />
												{/if}
											</button>
											<button
												type="button"
												onclick={() => setDownloadMode('csv')}
												class={`glass-option ${downloadMode === 'csv' ? 'is-active' : ''}`}
												aria-pressed={downloadMode === 'csv'}
											>
												<span class="glass-option__content">
													<span class="glass-option__label">
														<FileSpreadsheet size={16} />
														<span>Export links</span>
													</span>
												</span>
												{#if downloadMode === 'csv'}
													<Check size={14} class="glass-option__check" />
												{/if}
											</button>
										</div>
									</section>
									<section class="settings-section settings-section--bordered">
										<p class="section-heading">Queue actions</p>
										<div class="actions-column">
											<button
												onclick={handleQueueDownload}
												type="button"
												class="glass-action"
												disabled={queueActionBusy}
											>
												<span class="glass-action__label">
													{#if downloadMode === 'zip'}
														<Archive size={16} />
														<span>Download queue</span>
													{:else if downloadMode === 'csv'}
														<FileSpreadsheet size={16} />
														<span>Export queue links</span>
													{:else}
														<Download size={16} />
														<span>Download queue</span>
													{/if}
												</span>
												{#if queueActionBusy}
													<LoaderCircle size={16} class="glass-action__spinner" />
												{/if}
											</button>
											<button
												onclick={handleExportQueueCsv}
												type="button"
												class="glass-action"
												disabled={isCsvExporting}
											>
												<span class="glass-action__label">
													<FileSpreadsheet size={16} />
													<span>Export links as CSV</span>
												</span>
												{#if isCsvExporting}
													<LoaderCircle size={16} class="glass-action__spinner" />
												{/if}
											</button>
										</div>
										<p class="section-footnote">
											Queue actions follow your selection above. ZIP bundles require at least two tracks,
											while CSV exports capture the track links without downloading audio.
										</p>
									</section>
								</div>
							</div>
						{/if}
					</div>
					<a
						target="_blank"
						rel="noopener noreferrer"
						href="https://github.com/uimaxbai/tidal-ui"
						class="toolbar-icon"
						aria-label="Project GitHub"
					>
						<svg
							viewBox="0 0 98 96"
							class="toolbar-icon__svg"
							aria-hidden="true"
							width="98"
							height="96"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								fill-rule="evenodd"
								clip-rule="evenodd"
								d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
								fill="#fff"
							/>
						</svg>
					</a>
				</div>
			</div>
		</header>

		<main
			class="app-main glass-panel"
			style={`padding-bottom: ${contentPaddingBottom}px; min-height: ${mainMinHeight}px; margin-bottom: ${mainMarginBottom}px;`}
		>
			<div class="app-main__inner">
				{@render children?.()}
			</div>
		</main>

		<AudioPlayer onHeightChange={handlePlayerHeight} />
	</div>
</div>

<LyricsPopup />

<!--
{#if navigationState}
	<div
		transition:fade={{ duration: 200 }}
		class="navigation-overlay"
	>
		<div class="navigation-overlay__progress">
			<div class="navigation-progress"></div>
		</div>
		<div class="navigation-overlay__content">
			<span class="navigation-overlay__label">{navigationMessage()}</span>
		</div>
	</div>
{/if}
-->

<style>
	:global(:root) {
		--bloom-primary: #0f172a;
		--bloom-secondary: #1f2937;
		--bloom-accent: #3b82f6;
		--bloom-glow: rgba(59, 130, 246, 0.35);
		--bloom-tertiary: rgba(99, 102, 241, 0.32);
		--bloom-quaternary: rgba(30, 64, 175, 0.28);
		--surface-color: rgba(15, 23, 42, 0.68);
		--surface-border: rgba(148, 163, 184, 0.18);
		--surface-highlight: rgba(148, 163, 184, 0.35);
		--accent-color: var(--bloom-accent);
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family:
			'Figtree',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			'Helvetica Neue',
			Arial,
			sans-serif;
		background: radial-gradient(circle at top, rgba(15, 23, 42, 0.85), rgba(10, 12, 24, 0.95));
		color: #f8fafc;
	}

	.app-root {
		position: relative;
		min-height: 100vh;
		background-color: rgba(4, 7, 15, 0.9);
		color: inherit;
	}

	.app-shell {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		padding: clamp(1.25rem, 3vw, 2.5rem);
		gap: clamp(1rem, 1.5vw, 1.75rem);
	}

	.glass-panel {
		background: var(--surface-color, rgba(15, 23, 42, 0.68));
		border: 1px solid var(--surface-border, rgba(148, 163, 184, 0.18));
		border-radius: 28px;
		backdrop-filter: blur(32px) saturate(160%);
		-webkit-backdrop-filter: blur(32px) saturate(160%);
		box-shadow:
			0 30px 80px rgba(2, 6, 23, 0.55),
			0 4px 18px rgba(15, 23, 42, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transition: 
			background 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.app-header {
		position: sticky;
		top: calc(env(safe-area-inset-top, 0px) + clamp(0.75rem, 1.5vw, 1.5rem));
		padding: clamp(1.1rem, 2vw, 1.5rem) clamp(1.2rem, 2.5vw, 2rem);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		z-index: 12;
	}

	.app-header__inner {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: clamp(1rem, 2vw, 2.5rem);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		text-decoration: none;
		color: inherit;
		font-weight: 600;
		transition: opacity 150ms ease, transform 180ms ease;
	}

	.brand:hover {
		opacity: 0.88;
		transform: translateY(-1px);
	}

	.brand__title {
		font-size: clamp(1.4rem, 2.2vw, 1.9rem);
		margin: 0;
	}

	.brand__subtitle {
		margin: 0.15rem 0 0;
		font-size: 0.72rem;
		color: rgba(241, 245, 249, 0.6);
		font-weight: normal;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.85rem;
	}

	.toolbar-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.2);
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.55), rgba(15, 23, 42, 0.25));
		color: inherit;
		transition: border-color 160ms ease, transform 180ms ease, box-shadow 180ms ease;
	}

	.toolbar-icon:hover {
		transform: translateY(-1px);
		border-color: rgba(148, 163, 184, 0.38);
		box-shadow: 0 10px 30px rgba(8, 11, 19, 0.42);
	}

	.toolbar-icon__svg {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.toolbar-button {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		border-radius: 999px;
		border: 1px solid var(--surface-border, rgba(148, 163, 184, 0.18));
		padding: 0.55rem 0.95rem 0.55rem 0.85rem;
		font-size: 0.8rem;
		line-height: 1;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(24, 34, 56, 0.42));
		transition: 
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 160ms ease, 
			transform 160ms ease;
	}

	.toolbar-button:hover {
		border-color: var(--bloom-accent, rgba(148, 163, 184, 0.3));
		box-shadow: 0 12px 35px rgba(8, 11, 19, 0.38);
	}

	.toolbar-button.is-active {
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.68));
		box-shadow: 0 12px 32px rgba(59, 130, 246, 0.28);
	}

	.toolbar-button__label {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.toolbar-button__text {
		display: none;
	}

	.toolbar-button__chip {
		font-size: 0.65rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.15);
		border: 1px solid rgba(59, 130, 246, 0.28);
		color: rgba(191, 219, 254, 0.95);
	}

	.toolbar-button__chevron {
		transition: transform 180ms ease;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.toolbar-button__chevron.is-open {
		transform: rotate(180deg);
	}

	.settings-trigger {
		position: relative;
	}

	.settings-menu {
		position: fixed;
		top: var(--settings-menu-offset, 88px);
		left: calc(env(safe-area-inset-left, 0px) + 1.25rem);
		right: calc(env(safe-area-inset-right, 0px) + 1.25rem);
		margin: 0;
		max-height: calc(100vh - var(--settings-menu-offset, 88px) - 2.5rem);
		overflow-y: auto;
		padding: clamp(1.25rem, 2vw, 1.75rem);
		border-radius: 32px;
		background: var(--surface-color, rgba(15, 23, 42, 0.95));
		border: 1px solid var(--surface-border, rgba(148, 163, 184, 0.18));
		backdrop-filter: blur(48px) saturate(170%);
		-webkit-backdrop-filter: blur(48px) saturate(170%);
		box-shadow: 
			0 30px 80px rgba(2, 6, 23, 0.55),
			0 4px 18px rgba(15, 23, 42, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transition: 
			background 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.settings-grid {
		display: grid;
		gap: 1.25rem;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.settings-section--wide {
		grid-column: span 1;
	}

	.section-heading {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		font-weight: 700;
		margin: 0;
		color: rgba(203, 213, 225, 0.7);
	}

	.option-grid {
		display: grid;
		gap: 0.75rem;
	}

	.glass-option {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-radius: 18px;
		border: 1px solid rgba(148, 163, 184, 0.16);
		background: linear-gradient(145deg, rgba(15, 23, 42, 0.65), rgba(20, 30, 48, 0.45));
		padding: 0.75rem 0.9rem;
		color: inherit;
		font-size: 0.86rem;
		cursor: pointer;
		text-align: left;
		transition: border-color 140ms ease, transform 140ms ease, box-shadow 160ms ease;
	}

	.glass-option:hover {
		transform: translateY(-1px);
		box-shadow: 0 10px 30px rgba(15, 23, 42, 0.3);
	}

	.glass-option.is-active {
		border-color: rgba(59, 130, 246, 0.6);
		background: linear-gradient(145deg, rgba(37, 99, 235, 0.38), rgba(59, 130, 246, 0.22));
		box-shadow: 0 15px 35px rgba(59, 130, 246, 0.26);
	}

	.glass-option__content {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.glass-option__label {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 600;
	}

	.glass-option__description {
		font-size: 0.72rem;
		opacity: 0.65;
	}

	.glass-option__check {
		color: rgba(191, 219, 254, 0.95);
	}

	.glass-option__chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.68rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.45);
		color: rgba(226, 232, 240, 0.82);
	}

	.glass-option__chip.is-active {
		border-color: rgba(59, 130, 246, 0.65);
		color: rgba(219, 234, 254, 0.9);
	}

	.settings-section--bordered {
		padding-top: 1rem;
		border-top: 1px solid rgba(148, 163, 184, 0.12);
	}

	.actions-column {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.glass-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-radius: 18px;
		border: 1px solid rgba(148, 163, 184, 0.18);
		background: linear-gradient(140deg, rgba(15, 23, 42, 0.65), rgba(17, 25, 44, 0.52));
		padding: 0.8rem 1rem;
		font-size: 0.86rem;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		transition: border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease;
	}

	.glass-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.glass-action:hover:not(:disabled) {
		transform: translateY(-1px);
		border-color: rgba(148, 163, 184, 0.3);
		box-shadow: 0 12px 35px rgba(8, 11, 19, 0.38);
	}

	.glass-action__label {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.glass-action__spinner {
		animation: spin 1s linear infinite;
		color: rgba(203, 213, 225, 0.85);
	}

	.section-footnote {
		margin: 0;
		font-size: 0.72rem;
		color: rgba(203, 213, 225, 0.6);
		line-height: 1.4;
	}

	.app-main {
		flex: 1;
		padding: clamp(1.5rem, 2.4vw, 2.75rem);
		border-radius: 32px;
		position: relative;
		z-index: 1;
	}

	.app-main__inner {
		max-width: min(1100px, 100%);
		margin: 0 auto;
	}

	.navigation-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		background: rgba(6, 11, 22, 0.72);
		backdrop-filter: blur(18px);
		z-index: 50;
	}

	.navigation-overlay__progress {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		overflow: hidden;
		background: rgba(241, 245, 249, 0.08);
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

	.navigation-overlay__content {
		font-size: 0.78rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: rgba(226, 232, 240, 0.9);
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

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes spin-slower {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@media (min-width: 520px) {
		.toolbar-button__text {
			display: inline;
		}
	}

	@media (min-width: 768px) {
		.settings-menu {
			position: absolute;
			right: 0;
			left: auto;
			width: 32rem;
			max-height: none;
			padding: 1.5rem;
			border-radius: 28px;
			top: calc(var(--settings-menu-offset, 88px) - 35px);
		}

		.settings-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 1.5rem;
		}

		.settings-section--wide {
			grid-column: span 2;
		}

		.settings-section--bordered {
			border-left: 1px solid rgba(148, 163, 184, 0.12);
			border-top: none;
			padding-top: 0;
			padding-left: 1.35rem;
		}
	}

	@media (max-width: 640px) {
		.app-shell {
			padding: 1.1rem;
		}

		.app-header {
			border-radius: 22px;
		}

		.glass-panel {
			border-radius: 22px;
		}

		.toolbar {
			gap: 0.65rem;
		}

		.toolbar-button {
			padding: 0.5rem 0.8rem;
		}

		.app-main {
			padding: 1.4rem;
		}
	}
</style>
