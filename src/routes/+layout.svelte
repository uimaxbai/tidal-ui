<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { fade } from 'svelte/transition';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import LyricsPopup from '$lib/components/LyricsPopup.svelte';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadPreferencesStore, type DownloadMode } from '$lib/stores/downloadPreferences';
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
		Check
	} from 'lucide-svelte';
	import type { Navigation } from '@sveltejs/kit';
	import type { Track, AudioQuality } from '$lib/types';

	let { children, data } = $props();
	const pageTitle = $derived(data?.title ?? 'BiniTidal');
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let viewportHeight = $state(0);
	let navigationState = $state<Navigation | null>(null);
	let showDownloadMenu = $state(false);
	let isZipDownloading = $state(false);
	let isCsvExporting = $state(false);
	let isLegacyQueueDownloading = $state(false);
	let downloadMenuContainer: HTMLDivElement | null = null;
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
	const FRIENDLY_ROUTE_MESSAGES: Record<string, string> = {
		album: 'Opening album',
		artist: 'Visiting artist',
		playlist: 'Loading playlist'
	};

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
		const ext = getExtensionForQuality(quality);
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
					ffmpegAutoTriggered: false
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
			showDownloadMenu = false;
			alert('Add tracks to the queue before exporting.');
			return;
		}

		showDownloadMenu = false;
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
						ffmpegAutoTriggered: false
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
			showDownloadMenu = false;
			alert('Add tracks to the queue before downloading.');
			return;
		}

		showDownloadMenu = false;

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
			if (!showDownloadMenu) return;
			const root = downloadMenuContainer;
			if (!root) return;
			const target = event.target as Node | null;
			if (target && root.contains(target)) {
				return;
			}
			showDownloadMenu = false;
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

<div class="flex min-h-screen flex-col bg-neutral-800 text-white">
	<!-- Header -->
	<header
		class="sticky top-0 z-40 z-50 border-b border-gray-800 bg-neutral-800"
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

				<div class="flex items-center gap-2">
					<div class="relative" bind:this={downloadMenuContainer}>
						<button
							onclick={() => (showDownloadMenu = !showDownloadMenu)}
							type="button"
							class="flex items-center gap-2 rounded-lg border border-gray-800 bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
							aria-haspopup="true"
							aria-expanded={showDownloadMenu}
						>
							<span>Exports</span>
							<ChevronDown
								size={16}
								class={`transition-transform ${showDownloadMenu ? 'rotate-180' : ''}`}
							/>
						</button>
						{#if showDownloadMenu}
							<div
								class="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-gray-800 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur"
							>
								<div>
									<p class="px-1 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
										Download preference
									</p>
									<div class="mt-2 flex flex-col gap-2">
										<button
											type="button"
											onclick={() => setDownloadMode('individual')}
											class={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
												downloadMode === 'individual'
													? 'border-blue-500 bg-blue-900/40 text-white'
													: 'border-gray-800 text-gray-300 hover:bg-gray-800/70'
											}`}
											aria-pressed={downloadMode === 'individual'}
										>
											<span class="flex items-center gap-2">
												<Download size={16} />
												<span>Individual files</span>
											</span>
											{#if downloadMode === 'individual'}
												<Check size={14} />
											{/if}
										</button>
										<button
											type="button"
											onclick={() => setDownloadMode('zip')}
											class={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
												downloadMode === 'zip'
													? 'border-blue-500 bg-blue-900/40 text-white'
													: 'border-gray-800 text-gray-300 hover:bg-gray-800/70'
											}`}
											aria-pressed={downloadMode === 'zip'}
										>
											<span class="flex items-center gap-2">
												<Archive size={16} />
												<span>ZIP archive</span>
											</span>
											{#if downloadMode === 'zip'}
												<Check size={14} />
											{/if}
										</button>
										<button
											type="button"
											onclick={() => setDownloadMode('csv')}
											class={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
												downloadMode === 'csv'
													? 'border-blue-500 bg-blue-900/40 text-white'
													: 'border-gray-800 text-gray-300 hover:bg-gray-800/70'
											}`}
											aria-pressed={downloadMode === 'csv'}
										>
											<span class="flex items-center gap-2">
												<FileSpreadsheet size={16} />
												<span>Export links</span>
											</span>
											{#if downloadMode === 'csv'}
												<Check size={14} />
											{/if}
										</button>
									</div>
								</div>
								<button
									onclick={handleQueueDownload}
									type="button"
									class="mt-3 flex w-full items-center justify-between gap-3 rounded-lg border border-gray-800 bg-neutral-900 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
									disabled={queueActionBusy}
								>
									<span class="flex items-center gap-2">
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
										<LoaderCircle size={16} class="animate-spin text-gray-300" />
									{/if}
								</button>
								<button
									onclick={handleExportQueueCsv}
									type="button"
									class="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-gray-800 bg-neutral-900 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
									disabled={isCsvExporting}
								>
									<span class="flex items-center gap-2">
										<FileSpreadsheet size={16} />
										<span>Export links as CSV</span>
									</span>
									{#if isCsvExporting}
										<LoaderCircle size={16} class="animate-spin text-gray-300" />
									{/if}
								</button>
								<p class="mt-2 px-1 text-xs text-gray-500">
									Queue actions follow your selection above. ZIP bundles require at least two
									tracks, while CSV exports capture the track links without downloading audio.
								</p>
							</div>
						{/if}
					</div>
					<a
						target="_blank"
						rel="noopener noreferrer"
						href="https://github.com/uimaxbai/tidal-ui"
						class="flex aspect-square items-center gap-2 rounded-lg border border-gray-800 bg-neutral-900 p-2 text-white transition-colors hover:bg-gray-800"
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
					</a>
				</div>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="mb-36 flex-1 rounded-t-2xl bg-neutral-900">
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

<LyricsPopup />

<!--
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
-->
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
