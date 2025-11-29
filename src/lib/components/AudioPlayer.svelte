<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { playerStore } from '$lib/stores/player';
	import { lyricsStore } from '$lib/stores/lyrics';
	import { losslessAPI, DASH_MANIFEST_UNAVAILABLE_CODE, type TrackDownloadProgress } from '$lib/api';
	import type { DashManifestResult } from '$lib/api';
	import { getProxiedUrl } from '$lib/config';
	import { downloadUiStore, ffmpegBanner, activeTrackDownloads } from '$lib/stores/downloadUi';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { sanitizeForFilename, getExtensionForQuality, buildTrackFilename } from '$lib/downloads';
	import { formatArtists } from '$lib/utils';
	import type { Track, AudioQuality, SonglinkTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { convertToTidal, extractTidalInfo } from '$lib/utils/songlink';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		Play,
		Pause,
		SkipForward,
		SkipBack,
		Volume2,
		VolumeX,
		ListMusic,
		Trash2,
		X,
		Shuffle,
		ScrollText,
		Download,
		LoaderCircle
	} from 'lucide-svelte';

	type ShakaPlayerInstance = {
		load: (uri: string) => Promise<void>;
		unload: () => Promise<void>;
		destroy: () => Promise<void>;
		getNetworkingEngine?: () => {
			registerRequestFilter: (
				callback: (type: unknown, request: { method: string; uris: string[] }) => void
			) => void;
		};
	};

	type ShakaNamespace = {
		Player: new (mediaElement: HTMLMediaElement) =>  ShakaPlayerInstance;
		polyfill?: {
			installAll?: () => void;
		};
	};

	type ShakaModule = { default: ShakaNamespace };

	let audioElement: HTMLAudioElement;
	let streamUrl = $state('');
	let isMuted = $state(false);
	let previousVolume = 0.8;
	let currentTrackId: number | null = null;
	let loadSequence = 0;
	let bufferedPercent = $state(0);
	let lastQualityTrackId: number | null = null;
	let lastQualityForTrack: AudioQuality | null = null;
	let currentPlaybackQuality = $state<AudioQuality | null>(null);
	let isDownloadingCurrentTrack = $state(false);
	let downloadTaskIdForCurrentTrack: string | null = null;
	const { onHeightChange = () => {} } = $props<{ onHeightChange?: (height: number) => void }>();

	let containerElement: HTMLDivElement | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let showQueuePanel = $state(false);
	const streamCache = new Map<string, { url: string; replayGain: number | null }>();
	let preloadingCacheKey: string | null = null;
	const PRELOAD_THRESHOLD_SECONDS = 12;
	const hiResQualities = new Set<AudioQuality>(['HI_RES_LOSSLESS']);
	const dashManifestCache = new Map<string, DashManifestResult>();
	let shakaNamespace: ShakaNamespace | null = null;
	let shakaPlayer: ShakaPlayerInstance | null = null;
	let hiResObjectUrl: string | null = null;
	let shakaNetworkingConfigured = false;
	const sampleRateLabel = $derived(formatSampleRate($playerStore.sampleRate));
	const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
	let dashPlaybackActive = false;
	let dashFallbackAttemptedTrackId: number | null = null;
	let dashFallbackInFlight = false;

	const canUseMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
	let mediaSessionTrackId: number | null = null;
	let cleanupMediaSessionHandlers: (() => void) | null = null;
	let lastKnownPlaybackState: 'none' | 'paused' | 'playing' = 'none';
	let isSeeking = false;
	let seekBarElement = $state<HTMLButtonElement | null>(null);

	function getCacheKey(trackId: number, quality: AudioQuality) {
		return `${trackId}:${quality}`;
	}

	function isHiResQuality(quality: AudioQuality | undefined): boolean {
		return quality ? hiResQualities.has(quality) : false;
	}

	function revokeHiResObjectUrl() {
		if (hiResObjectUrl) {
			URL.revokeObjectURL(hiResObjectUrl);
			hiResObjectUrl = null;
		}
	}

	async function destroyShakaPlayer() {
		revokeHiResObjectUrl();
		if (shakaPlayer) {
			try {
				await shakaPlayer.destroy();
			} catch (error) {
				console.debug('Failed to destroy Shaka player', error);
			}
			shakaPlayer = null;
		}
		shakaNetworkingConfigured = false;
		dashPlaybackActive = false;
	}

	async function ensureShakaPlayer(): Promise<ShakaPlayerInstance> {
		if (!audioElement) {
			throw new Error('Audio element not ready for Shaka initialization');
		}
		if (!shakaNamespace) {
			// @ts-expect-error Shaka Player's compiled bundle does not expose module typings.
			const module = await import('shaka-player/dist/shaka-player.compiled.js');
			const resolved =
				(module as ShakaModule | { default: ShakaNamespace }).default ??
				(module as unknown as ShakaNamespace);
			shakaNamespace = resolved;
			if (shakaNamespace?.polyfill?.installAll) {
				try {
					shakaNamespace.polyfill.installAll();
				} catch (error) {
					console.debug('Shaka polyfill installation failed', error);
				}
			}
		}
		if (!shakaNamespace) {
			throw new Error('Shaka namespace unavailable');
		}
		if (!shakaPlayer) {
			shakaPlayer = new shakaNamespace.Player(audioElement);
			const networking = shakaPlayer.getNetworkingEngine?.();
			if (networking && !shakaNetworkingConfigured) {
				networking.registerRequestFilter((type, request) => {
					if (request.method === 'HEAD') {
						request.method = 'GET';
					}
					if (Array.isArray(request.uris)) {
						request.uris = request.uris.map((uri) => getProxiedUrl(uri));
					}
				});
				shakaNetworkingConfigured = true;
			}
		}
		audioElement.crossOrigin = 'anonymous';
		return shakaPlayer!;
	}

	function pruneDashManifestCache() {
		const keepKeys = new Set<string>();
		const dashQuality: AudioQuality = 'HI_RES_LOSSLESS';
		const current = $playerStore.currentTrack;
		if (current) {
			keepKeys.add(getCacheKey(current.id, dashQuality));
		}
		const { queue, queueIndex } = $playerStore;
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack) {
			keepKeys.add(getCacheKey(nextTrack.id, dashQuality));
		}
		for (const key of dashManifestCache.keys()) {
			if (!keepKeys.has(key)) {
				dashManifestCache.delete(key);
			}
		}
	}

	function cacheFlacFallback(trackId: number, result: DashManifestResult) {
		if (result.kind !== 'flac') {
			return;
		}
		const fallbackUrl = result.urls.find(
			(candidate) => typeof candidate === 'string' && candidate.length > 0
		);
		if (!fallbackUrl) {
			return;
		}
		const proxied = getProxiedUrl(fallbackUrl);
		streamCache.set(getCacheKey(trackId, 'LOSSLESS'), { url: proxied, replayGain: null });
	}

	async function resolveStream(
		track: Track,
		overrideQuality?: AudioQuality
	): Promise<{ url: string; replayGain: number | null }> {
		const quality = overrideQuality ?? $playerStore.quality;
		if (isHiResQuality(quality)) {
			throw new Error('Attempted to resolve hi-res stream via standard resolver');
		}
		const cacheKey = getCacheKey(track.id, quality);
		const cached = streamCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const data = await losslessAPI.getStreamData(track.id, quality);
		const proxied = getProxiedUrl(data.url);
		const entry = { url: proxied, replayGain: data.replayGain };
		streamCache.set(cacheKey, entry);
		return entry;
	}

	function pruneStreamCache() {
		const quality = $playerStore.quality;
		const keepKeys = new Set<string>();
		const baseQualities: AudioQuality[] = isHiResQuality(quality) ? ['LOSSLESS'] : [quality];
		const current = $playerStore.currentTrack;
		if (current) {
			for (const base of baseQualities) {
				keepKeys.add(getCacheKey(current.id, base));
			}
		}
		const { queue, queueIndex } = $playerStore;
		const nextTrack = queue[queueIndex + 1];
		if (nextTrack) {
			for (const base of baseQualities) {
				keepKeys.add(getCacheKey(nextTrack.id, base));
			}
		}

		for (const key of streamCache.keys()) {
			if (!keepKeys.has(key)) {
				streamCache.delete(key);
			}
		}
	}

	async function preloadDashManifest(track: Track) {
		const cacheKey = getCacheKey(track.id, 'HI_RES_LOSSLESS');
		if (dashManifestCache.has(cacheKey) || preloadingCacheKey === cacheKey) {
			const cached = dashManifestCache.get(cacheKey);
			if (cached) {
				cacheFlacFallback(track.id, cached);
			}
			return;
		}

		preloadingCacheKey = cacheKey;
		try {
			const result = await losslessAPI.getDashManifest(track.id, 'HI_RES_LOSSLESS');
			dashManifestCache.set(cacheKey, result);
			cacheFlacFallback(track.id, result);
			pruneDashManifestCache();
		} catch (error) {
			console.warn('Failed to preload dash manifest:', error);
		} finally {
			if (preloadingCacheKey === cacheKey) {
				preloadingCacheKey = null;
			}
		}
	}

	async function preloadNextTrack(track: Track) {
		const cacheKey = getCacheKey(track.id, 'HI_RES_LOSSLESS');
		if (dashManifestCache.has(cacheKey) || preloadingCacheKey === cacheKey) {
			return;
		}
		await preloadDashManifest(track);
	}

	/**
	 * Convert a SonglinkTrack to a full TIDAL Track
	 * This is called when a Songlink track is about to be played
	 */
	async function convertSonglinkTrackToTidal(songlinkTrack: SonglinkTrack): Promise<Track> {
		console.log('Converting SonglinkTrack to TIDAL:', songlinkTrack.title);

		// Use the stored Songlink data to find the TIDAL URL
		const tidalInfo = extractTidalInfo(songlinkTrack.songlinkData);

		if (!tidalInfo || tidalInfo.type !== 'track') {
			// Fallback: try converting from the source URL
			console.warn('No TIDAL track in Songlink data, attempting conversion...');
			const fallbackTidalInfo = await convertToTidal(songlinkTrack.sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!fallbackTidalInfo || fallbackTidalInfo.type !== 'track') {
				throw new Error(`Could not find TIDAL equivalent for: ${songlinkTrack.title}`);
			}

			// Validate that the ID is numeric (TIDAL tracks have numeric IDs)
			const trackId = Number(fallbackTidalInfo.id);
			if (!Number.isFinite(trackId) || trackId <= 0) {
				throw new Error(`Invalid TIDAL track ID for: ${songlinkTrack.title} (got: ${fallbackTidalInfo.id})`);
			}

			const trackLookup = await losslessAPI.getTrack(trackId);
			if (!trackLookup?.track) {
				throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
			}

			return trackLookup.track;
		}

		// Validate that we have a numeric TIDAL ID
		const trackId = Number(tidalInfo.id);
		if (!Number.isFinite(trackId) || trackId <= 0) {
			// The ID is not numeric, try fallback conversion
			console.warn(`Non-numeric TIDAL ID (${tidalInfo.id}), attempting fallback conversion...`);
			const fallbackTidalInfo = await convertToTidal(songlinkTrack.sourceUrl, {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!fallbackTidalInfo || fallbackTidalInfo.type !== 'track') {
				throw new Error(`Could not find TIDAL equivalent for: ${songlinkTrack.title}`);
			}

			const fallbackId = Number(fallbackTidalInfo.id);
			if (!Number.isFinite(fallbackId) || fallbackId <= 0) {
				throw new Error(`No valid TIDAL track found for: ${songlinkTrack.title}`);
			}

			const trackLookup = await losslessAPI.getTrack(fallbackId);
			if (!trackLookup?.track) {
				throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
			}

			return trackLookup.track;
		}

		// We found TIDAL info in the Songlink data, fetch the full track
		const trackLookup = await losslessAPI.getTrack(trackId);
		if (!trackLookup?.track) {
			throw new Error(`Failed to fetch TIDAL track for: ${songlinkTrack.title}`);
		}

		console.log('Successfully converted to TIDAL track:', trackLookup.track.title);
		return trackLookup.track;
	}

	function maybePreloadNextTrack(remainingSeconds: number) {
		if (remainingSeconds > PRELOAD_THRESHOLD_SECONDS) {
			return;
		}
		const { queue, queueIndex } = $playerStore;
		const nextTrack = queue[queueIndex + 1];
		if (!nextTrack || isSonglinkTrack(nextTrack)) {
			return; // Don't preload Songlink tracks
		}
		const dashKey = getCacheKey(nextTrack.id, 'HI_RES_LOSSLESS');
		if (dashManifestCache.has(dashKey) || preloadingCacheKey === dashKey) {
			return;
		}
		preloadNextTrack(nextTrack);
	}

	// Track which Songlink tracks are currently being converted to prevent duplicates
	const convertingTracks = new Set<string>();

	// Effect to convert SonglinkTrack to Track when needed
	$effect(() => {
		const current = $playerStore.currentTrack;
		if (current && isSonglinkTrack(current)) {
			console.log('[Conversion Effect] Detected SonglinkTrack:', current.title, 'ID:', current.id);
			
			// Check if this track is already being converted
			if (convertingTracks.has(current.id)) {
				console.log('[Conversion Effect] Track already being converted, skipping');
				return;
			}

			// Mark this track as being converted
			convertingTracks.add(current.id);
			console.log('[Conversion Effect] Starting conversion for:', current.title);

			// Convert the Songlink track to a TIDAL track and update the store
			convertSonglinkTrackToTidal(current)
				.then((tidalTrack) => {
					console.log('[Conversion Effect] Conversion SUCCESS:', tidalTrack.title, 'TIDAL ID:', tidalTrack.id);
					// Only update if this is still the current track
					const state = get(playerStore);
					if (state.currentTrack && isSonglinkTrack(state.currentTrack) && state.currentTrack.id === current.id) {
						console.log('[Conversion Effect] Updating player with converted track');
						playerStore.setTrack(tidalTrack);
					} else {
						console.log('[Conversion Effect] Track changed during conversion, not updating');
					}
				})
				.catch((error) => {
					console.error('[Conversion Effect] Conversion FAILED:', error);
					alert(`Failed to play track: ${error instanceof Error ? error.message : 'Unknown error'}`);
				})
				.finally(() => {
					// Remove from converting set when done
					convertingTracks.delete(current.id);
					console.log('[Conversion Effect] Finished conversion attempt for:', current.title);
				});
		}
	});

	$effect(() => {
		const current = $playerStore.currentTrack;
		if (!audioElement || !current) {
			if (!current) {
				currentTrackId = null;
				streamUrl = '';
				bufferedPercent = 0;
				dashPlaybackActive = false;
				dashFallbackAttemptedTrackId = null;
				dashFallbackInFlight = false;
				lastQualityTrackId = null;
				lastQualityForTrack = null;
				currentPlaybackQuality = null;
			}
		} else if (current.id !== currentTrackId) {
			// Don't load SonglinkTracks - wait for them to be converted first
			if (isSonglinkTrack(current)) {
				return;
			}
			
			currentTrackId = current.id;
			streamUrl = '';
			bufferedPercent = 0;
			dashPlaybackActive = false;
			dashFallbackAttemptedTrackId = null;
			dashFallbackInFlight = false;
			lastQualityTrackId = current.id;
			lastQualityForTrack = $playerStore.quality;
			currentPlaybackQuality = null;
			loadTrack(current);
		}
	});

	$effect(() => {
		const track = $playerStore.currentTrack;
		if (!audioElement || !track) {
			return;
		}
		const quality = $playerStore.quality;
		if (lastQualityTrackId === track.id && lastQualityForTrack === quality) {
			return;
		}
		lastQualityTrackId = track.id;
		lastQualityForTrack = quality;
		loadTrack(track);
	});

	$effect(() => {
		if (showQueuePanel && $playerStore.queue.length === 0) {
			showQueuePanel = false;
		}
	});

	$effect(() => {
		if (canUseMediaSession) {
			updateMediaSessionMetadata($playerStore.currentTrack);
		}
	});

	$effect(() => {
		if (canUseMediaSession) {
			const hasTrack = Boolean($playerStore.currentTrack);
			updateMediaSessionPlaybackState(
				hasTrack ? ($playerStore.isPlaying ? 'playing' : 'paused') : 'none'
			);
		}
	});

	function toggleQueuePanel() {
		showQueuePanel = !showQueuePanel;
	}

	function closeQueuePanel() {
		showQueuePanel = false;
	}

	function playFromQueue(index: number) {
		playerStore.playAtIndex(index);
	}

	function removeFromQueue(index: number, event?: MouseEvent) {
		if (event) {
			event.stopPropagation();
		}
		playerStore.removeFromQueue(index);
	}

	function clearQueue() {
		playerStore.clearQueue();
	}

	function handleShuffleQueue() {
		playerStore.shuffleQueue();
	}

	$effect(() => {
		if (audioElement) {
			const baseVolume = $playerStore.volume;
			const replayGain = $playerStore.replayGain;

			if (replayGain !== null && typeof replayGain === 'number') {
				// Apply replay gain: volume * 10^(gain / 20)
				const gainFactor = Math.pow(10, replayGain / 20);
				const adjusted = baseVolume * gainFactor;
				audioElement.volume = Math.min(1, Math.max(0, adjusted));
			} else {
				audioElement.volume = baseVolume;
			}
		}
	});

	$effect(() => {
		if ($playerStore.isPlaying && audioElement) {
			audioElement.play().catch(console.error);
		} else if (!$playerStore.isPlaying && audioElement) {
			audioElement.pause();
		}
	});

	async function loadStandardTrack(track: Track, quality: AudioQuality, sequence: number) {
		await destroyShakaPlayer();
		dashPlaybackActive = false;
		const { url, replayGain } = await resolveStream(track, quality);
		if (sequence !== loadSequence) {
			return;
		}
		streamUrl = url;
		currentPlaybackQuality = quality;
		playerStore.setReplayGain(replayGain);
		pruneStreamCache();
		if (audioElement) {
			audioElement.crossOrigin = 'anonymous';
			audioElement.load();
		}
	}

	async function loadDashTrack(
		track: Track,
		quality: AudioQuality,
		sequence: number
	): Promise<DashManifestResult> {
		const cacheKey = getCacheKey(track.id, quality);
		let manifestResult = dashManifestCache.get(cacheKey);
		if (!manifestResult) {
			manifestResult = await losslessAPI.getDashManifest(track.id, quality);
			dashManifestCache.set(cacheKey, manifestResult);
		}
		cacheFlacFallback(track.id, manifestResult);
		if (manifestResult.kind === 'flac') {
			dashPlaybackActive = false;
			return manifestResult;
		}
		revokeHiResObjectUrl();
		const blob = new Blob([manifestResult.manifest], {
			type: manifestResult.contentType ?? 'application/dash+xml'
		});
		hiResObjectUrl = URL.createObjectURL(blob);
		const player = await ensureShakaPlayer();
		if (sequence !== loadSequence) {
			return manifestResult;
		}
		if (audioElement) {
			audioElement.pause();
			audioElement.removeAttribute('src');
			audioElement.load();
		}
		await player.unload();
		await player.load(hiResObjectUrl);
		dashPlaybackActive = true;
		streamUrl = '';
		currentPlaybackQuality = 'HI_RES_LOSSLESS';
		pruneDashManifestCache();
		return manifestResult;
	}

	async function updateTrackMetadata(
		track: Track,
		quality: AudioQuality,
		sequence: number
	): Promise<void> {
		try {
			const metadata = await losslessAPI.getPreferredTrackMetadata(track.id, quality);
			if (sequence !== loadSequence) {
				return;
			}
			if (currentTrackId !== track.id) {
				return;
			}
			const rate = metadata.info?.sampleRate;
			const normalized =
				typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? Math.round(rate) : null;
			playerStore.setSampleRate(normalized ?? null);

			const gain = metadata.info?.trackReplayGain;
			if (typeof gain === 'number') {
				playerStore.setReplayGain(gain);
			}
		} catch (error) {
			console.debug('Failed to update track metadata', error);
			if (sequence === loadSequence && currentTrackId === track.id) {
				playerStore.setSampleRate(null);
				// Don't reset replayGain here as it might have been set by loadStandardTrack
			}
		}
	}

	async function loadTrack(track: Track) {
		// CRITICAL: Never try to load a SonglinkTrack - it must be converted first
		if ('isSonglinkTrack' in track && (track as any).isSonglinkTrack) {
			console.error('Attempted to load SonglinkTrack directly - this should not happen!', track);
			return;
		}

		// Validate that we have a numeric track ID
		const trackId = Number(track.id);
		if (!Number.isFinite(trackId) || trackId <= 0) {
			console.error('Invalid track ID - must be numeric:', track.id);
			return;
		}

		const sequence = ++loadSequence;
		playerStore.setLoading(true);
		bufferedPercent = 0;
		currentPlaybackQuality = null;
		const requestedQuality = $playerStore.quality;
		const scheduleMetadataUpdate = (quality: AudioQuality) => {
			void updateTrackMetadata(track, quality, sequence);
		};
		if (dashFallbackAttemptedTrackId && dashFallbackAttemptedTrackId !== track.id) {
			dashFallbackAttemptedTrackId = null;
		}

		try {
			if (isHiResQuality(requestedQuality)) {
				try {
					const hiResQuality: AudioQuality = 'HI_RES_LOSSLESS';
					const result = await loadDashTrack(track, hiResQuality, sequence);
					if (result.kind === 'dash') {
						scheduleMetadataUpdate(hiResQuality);
						return;
					}
					console.info('Dash endpoint returned FLAC fallback. Using lossless stream.');
				} catch (dashError) {
					const coded = dashError as { code?: string };
					if (coded?.code === DASH_MANIFEST_UNAVAILABLE_CODE) {
						dashManifestCache.delete(getCacheKey(track.id, 'HI_RES_LOSSLESS'));
					}
					console.warn('DASH playback failed, falling back to lossless stream.', dashError);
				}
				scheduleMetadataUpdate('LOSSLESS');
				await loadStandardTrack(track, 'LOSSLESS', sequence);
				return;
			}

			await loadStandardTrack(track, requestedQuality, sequence);
			scheduleMetadataUpdate(requestedQuality);
		} catch (error) {
			console.error('Failed to load track:', error);
			if (
				sequence === loadSequence &&
				requestedQuality !== 'LOSSLESS' &&
				!isHiResQuality(requestedQuality)
			) {
				try {
					await loadStandardTrack(track, 'LOSSLESS', sequence);
					scheduleMetadataUpdate('LOSSLESS');
				} catch (fallbackError) {
					console.error('Secondary lossless fallback failed:', fallbackError);
				}
			}
		} finally {
			if (sequence === loadSequence) {
				playerStore.setLoading(false);
			}
		}
	}

	function handleTimeUpdate() {
		if (audioElement) {
			playerStore.setCurrentTime(audioElement.currentTime);
			updateBufferedPercent();
			const remaining = ($playerStore.duration ?? 0) - audioElement.currentTime;
			maybePreloadNextTrack(remaining);
			updateMediaSessionPositionState();
		}
	}

	async function fallbackToLosslessAfterDashError(reason: string) {
		if (dashFallbackInFlight) {
			return;
		}
		const track = $playerStore.currentTrack;
		if (!track) {
			return;
		}
		if (dashFallbackAttemptedTrackId === track.id) {
			return;
		}
		dashFallbackInFlight = true;
		dashFallbackAttemptedTrackId = track.id;
		const sequence = ++loadSequence;
		console.warn(`Attempting lossless fallback after DASH playback error (${reason}).`);
		try {
			dashPlaybackActive = false;
			playerStore.setLoading(true);
			bufferedPercent = 0;
			await loadStandardTrack(track, 'LOSSLESS', sequence);
			await updateTrackMetadata(track, 'LOSSLESS', sequence);
		} catch (fallbackError) {
			console.error('Lossless fallback after DASH playback error failed', fallbackError);
			if (sequence === loadSequence) {
				playerStore.setLoading(false);
			}
		} finally {
			dashFallbackInFlight = false;
		}
	}

	function handleAudioError(event: Event) {
		if (!dashPlaybackActive || !isFirefox) {
			return;
		}
		const element = event.currentTarget as HTMLAudioElement | null;
		const mediaError = element?.error ?? null;
		const code = mediaError?.code;
		const decodeConstant = mediaError?.MEDIA_ERR_DECODE;
		const isDecodeError =
			typeof code === 'number' && typeof decodeConstant === 'number'
				? code === decodeConstant
				: false;
		const reason = isDecodeError ? 'decode error' : code ? `code ${code}` : 'unknown error';
		void fallbackToLosslessAfterDashError(reason);
	}

	function handleDurationChange() {
		if (audioElement) {
			playerStore.setDuration(audioElement.duration);
			updateBufferedPercent();
			updateMediaSessionPositionState();
		}
	}

	function updateBufferedPercent() {
		if (!audioElement) {
			bufferedPercent = 0;
			return;
		}

		const { duration, buffered, currentTime } = audioElement;
		if (!Number.isFinite(duration) || duration <= 0 || buffered.length === 0) {
			bufferedPercent = 0;
			return;
		}

		let bufferedEnd = 0;
		for (let i = 0; i < buffered.length; i += 1) {
			const start = buffered.start(i);
			const end = buffered.end(i);
			if (start <= currentTime && end >= currentTime) {
				bufferedEnd = end;
				break;
			}
			bufferedEnd = Math.max(bufferedEnd, end);
		}

		bufferedPercent = Math.max(0, Math.min(100, (bufferedEnd / duration) * 100));
	}

	function handleProgress() {
		updateBufferedPercent();
	}

	function handleLoadedData() {
		playerStore.setLoading(false);
		updateBufferedPercent();
		updateMediaSessionPositionState();
	}

	function getPercent(current: number, total: number): number {
		if (!Number.isFinite(total) || total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (current / total) * 100));
	}

	function handleEnded() {
		playerStore.next();
		updateMediaSessionPositionState();
	}

	function handleSeek(event: MouseEvent | TouchEvent) {
		if (!seekBarElement) return;

		const rect = seekBarElement.getBoundingClientRect();
		const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
		const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const newTime = percent * $playerStore.duration;

		if (audioElement) {
			audioElement.currentTime = newTime;
			playerStore.setCurrentTime(newTime);
			updateMediaSessionPositionState();
		}
	}

	function handleSeekStart(event: MouseEvent | TouchEvent) {
		event.preventDefault();
		isSeeking = true;
		handleSeek(event);

		const handleMove = (e: MouseEvent | TouchEvent) => {
			if (isSeeking) {
				handleSeek(e);
			}
		};

		const handleEnd = () => {
			isSeeking = false;
			document.removeEventListener('mousemove', handleMove as EventListener);
			document.removeEventListener('mouseup', handleEnd);
			document.removeEventListener('touchmove', handleMove as EventListener);
			document.removeEventListener('touchend', handleEnd);
		};

		document.addEventListener('mousemove', handleMove as EventListener);
		document.addEventListener('mouseup', handleEnd);
		document.addEventListener('touchmove', handleMove as EventListener);
		document.addEventListener('touchend', handleEnd);
	}

	function handleVolumeChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const newVolume = parseFloat(target.value);
		playerStore.setVolume(newVolume);
		if (newVolume > 0 && isMuted) {
			isMuted = false;
		}
	}

	function handleLyricsSeekEvent(event: Event) {
		const customEvent = event as CustomEvent<{ timeSeconds?: number }>;
		const targetSeconds = customEvent.detail?.timeSeconds;
		if (typeof targetSeconds !== 'number' || !audioElement) {
			return;
		}

		const seekSeconds = Math.max(0, targetSeconds);
		audioElement.currentTime = seekSeconds;
		playerStore.setCurrentTime(seekSeconds);
		updateMediaSessionPositionState();

		const state = get(playerStore);
		if (!state.isPlaying) {
			playerStore.play();
		}

		audioElement.play().catch(() => {});
	}

	async function handleDownloadCurrentTrack() {
		const track = $playerStore.currentTrack;
		if (!track || isDownloadingCurrentTrack) {
			return;
		}

		const quality = $playerStore.quality;
		const convertAacToMp3 = $userPreferencesStore.convertAacToMp3;
		const downloadCoverSeperately = $userPreferencesStore.downloadCoversSeperately;
		const filename = buildTrackFilename(
			track.album,
			track,
			quality,
			formatArtists(track.artists),
			convertAacToMp3
		);

		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: track.album?.title ?? track.artist?.name
		});

		downloadTaskIdForCurrentTrack = taskId;
		isDownloadingCurrentTrack = true;
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
					if (typeof totalBytes === 'number') {
						downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered: false });
					} else {
						downloadUiStore.startFfmpegCountdown(0, { autoTriggered: false });
					}
				},
				onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
				onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
				onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
				onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
				ffmpegAutoTriggered: false,
				convertAacToMp3,
				downloadCoverSeperately
			});
			downloadUiStore.completeTrackDownload(taskId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId);
			} else {
				console.error('Failed to download track:', error);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = error instanceof Error && error.message ? error.message : fallbackMessage;
				downloadUiStore.errorTrackDownload(taskId, message);
				alert(message);
			}
		} finally {
			isDownloadingCurrentTrack = false;
			downloadTaskIdForCurrentTrack = null;
		}
	}

	function toggleMute() {
		if (isMuted) {
			playerStore.setVolume(previousVolume);
			isMuted = false;
		} else {
			previousVolume = $playerStore.volume;
			playerStore.setVolume(0);
			isMuted = true;
		}
	}

	function formatTime(seconds: number): string {
		if (isNaN(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function formatQualityLabel(quality?: string): string {
		if (!quality) return '—';
		const normalized = quality.toUpperCase();
		if (normalized === 'LOSSLESS') {
			return 'CD';
		}
		if (normalized === 'HI_RES_LOSSLESS') {
			return 'Hi-Res';
		}
		return quality;
	}

	function formatSampleRate(value?: number | null): string | null {
		if (!Number.isFinite(value ?? NaN) || !value || value <= 0) {
			return null;
		}
		const kilohertz = value / 1000;
		const precision =
			kilohertz >= 100 || Math.abs(kilohertz - Math.round(kilohertz)) < 0.05 ? 0 : 1;
		const formatted = kilohertz.toFixed(precision).replace(/\.0$/, '');
		return `${formatted} kHz`;
	}

	function formatMegabytes(bytes?: number | null): string | null {
		if (!Number.isFinite(bytes ?? NaN) || !bytes || bytes <= 0) {
			return null;
		}
		const value = bytes / (1024 * 1024);
		const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
		return `${value.toFixed(digits)} MB`;
	}

	function formatPercent(value: number | null | undefined): string {
		if (!Number.isFinite(value ?? NaN)) {
			return '0%';
		}
		const percent = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
		return `${percent}%`;
	}

	function formatTransferStatus(received: number, total?: number): string {
		const receivedLabel = formatMegabytes(received) ?? '0 MB';
		const totalLabel = formatMegabytes(total) ?? null;
		return totalLabel ? `${receivedLabel} / ${totalLabel}` : receivedLabel;
	}

	$effect(() => {
		if ($ffmpegBanner.phase === 'ready') {
			const timeout = setTimeout(() => {
				downloadUiStore.dismissFfmpeg();
			}, 3200);
			return () => clearTimeout(timeout);
		}
	});

	function getMediaSessionArtwork(track: Track): MediaImage[] {
		if (!track.album?.cover) {
			return [];
		}

		const sizes = ['80', '160', '320', '640', '1280'] as const;
		const artwork: MediaImage[] = [];

		for (const size of sizes) {
			const src = losslessAPI.getCoverUrl(track.album.cover, size);
			if (src) {
				artwork.push({
					src,
					sizes: `${size}x${size}`,
					type: 'image/jpeg'
				});
			}
		}

		return artwork;
	}

	function updateMediaSessionMetadata(track: Track | null) {
		if (!canUseMediaSession) {
			return;
		}

		if (!track) {
			mediaSessionTrackId = null;
			lastKnownPlaybackState = 'none';
			try {
				navigator.mediaSession.metadata = null;
				navigator.mediaSession.playbackState = 'none';
			} catch (error) {
				console.debug('Media Session reset failed', error);
			}
			return;
		}

		if (mediaSessionTrackId === track.id) {
			return;
		}

		mediaSessionTrackId = track.id;

		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: formatArtists(track.artists),
				album: track.album?.title ?? '',
				artwork: getMediaSessionArtwork(track)
			});
		} catch (error) {
			console.debug('Unable to set Media Session metadata', error);
		}

		updateMediaSessionPositionState();
	}

	function updateMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none') {
		if (!canUseMediaSession) {
			return;
		}

		if (lastKnownPlaybackState === state) {
			return;
		}
		lastKnownPlaybackState = state;

		try {
			navigator.mediaSession.playbackState = state;
		} catch (error) {
			console.debug('Unable to set Media Session playback state', error);
		}
	}

	function updateMediaSessionPositionState() {
		if (
			!canUseMediaSession ||
			!audioElement ||
			typeof navigator.mediaSession.setPositionState !== 'function'
		) {
			return;
		}

		const durationFromAudio = audioElement.duration;
		const storeState = get(playerStore);
		const duration = Number.isFinite(durationFromAudio) ? durationFromAudio : storeState.duration;

		try {
			navigator.mediaSession.setPositionState({
				duration: Number.isFinite(duration) ? duration : 0,
				playbackRate: audioElement.playbackRate ?? 1,
				position: audioElement.currentTime
			});
		} catch (error) {
			console.debug('Unable to set Media Session position state', error);
		}
	}

	function registerMediaSessionHandlers() {
		if (!canUseMediaSession) {
			return;
		}

		const safeSetActionHandler = (
			action: MediaSessionAction,
			handler: MediaSessionActionHandler | null
		) => {
			try {
				navigator.mediaSession.setActionHandler(action, handler);
			} catch (error) {
				console.debug(`Media Session action ${action} unsupported`, error);
			}
		};

		safeSetActionHandler('play', async () => {
			playerStore.play();
			if (!audioElement) return;
			try {
				await audioElement.play();
			} catch (error) {
				console.debug('Media Session play failed', error);
			}
			updateMediaSessionPlaybackState('playing');
			updateMediaSessionPositionState();
		});

		safeSetActionHandler('pause', () => {
			playerStore.pause();
			audioElement?.pause();
			updateMediaSessionPlaybackState('paused');
			updateMediaSessionPositionState();
		});

		safeSetActionHandler('previoustrack', () => {
			playerStore.previous();
		});

		safeSetActionHandler('nexttrack', () => {
			playerStore.next();
		});

		const handleSeekDelta =
			(direction: 'forward' | 'backward') => (details: MediaSessionActionDetails) => {
				if (!audioElement) return;
				const offset = details.seekOffset ?? 10;
				const delta = direction === 'forward' ? offset : -offset;
				const tentative = audioElement.currentTime + delta;
				const duration = audioElement.duration;
				const bounded = Number.isFinite(duration)
					? Math.min(Math.max(0, tentative), Math.max(duration, 0))
					: Math.max(0, tentative);
				audioElement.currentTime = bounded;
				playerStore.setCurrentTime(bounded);
				updateMediaSessionPositionState();
			};

		safeSetActionHandler('seekforward', handleSeekDelta('forward'));
		safeSetActionHandler('seekbackward', handleSeekDelta('backward'));

		safeSetActionHandler('seekto', (details) => {
			if (!audioElement || details.seekTime === undefined) return;
			const nextTime = Math.max(0, details.seekTime);
			audioElement.currentTime = nextTime;
			playerStore.setCurrentTime(nextTime);
			updateMediaSessionPositionState();
		});

		safeSetActionHandler('stop', () => {
			playerStore.pause();
			if (audioElement) {
				audioElement.pause();
				audioElement.currentTime = 0;
			}
			playerStore.setCurrentTime(0);
			updateMediaSessionPlaybackState('paused');
			updateMediaSessionPositionState();
		});

		cleanupMediaSessionHandlers = () => {
			const actions: MediaSessionAction[] = [
				'play',
				'pause',
				'previoustrack',
				'nexttrack',
				'seekforward',
				'seekbackward',
				'seekto',
				'stop'
			];
			for (const action of actions) {
				safeSetActionHandler(action, null);
			}
			mediaSessionTrackId = null;
			lastKnownPlaybackState = 'none';
		};
	}

	onMount(() => {
		let detachLyricsSeek: (() => void) | null = null;

		if (audioElement) {
			audioElement.volume = $playerStore.volume;
		}

		if (containerElement) {
			notifyContainerHeight();
			resizeObserver = new ResizeObserver(() => {
				notifyContainerHeight();
			});
			resizeObserver.observe(containerElement);
		}

		if (canUseMediaSession) {
			registerMediaSessionHandlers();
			const state = get(playerStore);
			updateMediaSessionMetadata(state.currentTrack);
			updateMediaSessionPlaybackState(
				state.currentTrack ? (state.isPlaying ? 'playing' : 'paused') : 'none'
			);
			updateMediaSessionPositionState();
		}

		if (typeof window !== 'undefined') {
			const listener = (event: Event) => handleLyricsSeekEvent(event);
			window.addEventListener('lyrics:seek', listener as EventListener);
			detachLyricsSeek = () => {
				window.removeEventListener('lyrics:seek', listener as EventListener);
			};
		}

		return () => {
			resizeObserver?.disconnect();
			cleanupMediaSessionHandlers?.();
			cleanupMediaSessionHandlers = null;
			detachLyricsSeek?.();
			destroyShakaPlayer().catch((error) => {
				console.debug('Shaka cleanup failed', error);
			});
			if (canUseMediaSession) {
				try {
					navigator.mediaSession.metadata = null;
					navigator.mediaSession.playbackState = 'none';
				} catch (error) {
					console.debug('Failed to clean up Media Session', error);
				}
			}
		};
	});

	function notifyContainerHeight() {
		if (typeof onHeightChange === 'function' && containerElement) {
			const height = containerElement.offsetHeight ?? 0;
			onHeightChange(height);
			// Set CSS variable for other components (like lyrics popup)
			if (typeof document !== 'undefined') {
				document.documentElement.style.setProperty('--player-height', `${height}px`);
			}
		}
	}
</script>

<audio
	bind:this={audioElement}
	src={streamUrl}
	ontimeupdate={handleTimeUpdate}
	ondurationchange={handleDurationChange}
	onended={handleEnded}
	onloadeddata={handleLoadedData}
	onloadedmetadata={updateBufferedPercent}
	onprogress={handleProgress}
	onerror={handleAudioError}
	class="hidden"
></audio>

<div
	class="audio-player-backdrop fixed inset-x-0 bottom-0 z-50 px-4 pt-16 pb-5 sm:px-6 sm:pt-16 sm:pb-6"
	bind:this={containerElement}
>
	<div class="relative mx-auto w-full max-w-screen-2xl">
		{#if $ffmpegBanner.phase !== 'idle' || $activeTrackDownloads.length > 0}
			<div
				class="pointer-events-none absolute top-0 right-0 left-0 -translate-y-full transform pb-4"
			>
				<div class="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4">
					{#if $ffmpegBanner.phase !== 'idle'}
						<div
							class="ffmpeg-banner pointer-events-auto rounded-2xl border px-4 py-3 text-sm text-blue-100 shadow-xl"
						>
							<div class="flex items-start gap-3">
								<div class="min-w-0 flex-1">
									<p class="leading-5 font-semibold text-blue-50">
										Downloading FFmpeg
										{#if formatMegabytes($ffmpegBanner.totalBytes)}
											<span class="text-blue-100/80">
												({formatMegabytes($ffmpegBanner.totalBytes)})</span
											>
										{/if}
									</p>
									{#if $ffmpegBanner.phase === 'countdown'}
										<p class="mt-1 text-xs text-blue-100/80">
											Starting in {$ffmpegBanner.countdownSeconds} seconds…
										</p>
									{:else if $ffmpegBanner.phase === 'loading'}
										<p class="mt-1 text-xs text-blue-100/80">
											Preparing encoder… {formatPercent($ffmpegBanner.progress)}
										</p>
									{:else if $ffmpegBanner.phase === 'ready'}
										<p class="mt-1 text-xs text-blue-100/80">FFmpeg is ready to use.</p>
									{:else if $ffmpegBanner.phase === 'error'}
										<p class="mt-1 text-xs text-red-200">
											{$ffmpegBanner.error ?? 'Failed to load FFmpeg.'}
										</p>
									{/if}
								</div>
								{#if $ffmpegBanner.dismissible}
									<button
										onclick={() => downloadUiStore.dismissFfmpeg()}
										class="rounded-full p-1 text-blue-100/70 transition-colors hover:bg-blue-500/20 hover:text-blue-50"
										aria-label="Dismiss FFmpeg download"
									>
										<X size={16} />
									</button>
								{/if}
							</div>
							{#if $ffmpegBanner.phase === 'loading'}
								<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-500/20">
									<div
										class="h-full rounded-full bg-blue-400 transition-all duration-200"
										style="width: {Math.min(Math.max($ffmpegBanner.progress * 100, 6), 100)}%"
									></div>
								</div>
							{/if}
						</div>
					{/if}

					{#each $activeTrackDownloads as task (task.id)}
						<div
							class="download-popup pointer-events-auto rounded-2xl border px-4 py-3 text-sm text-gray-100 shadow-xl"
						>
							<div class="flex items-start gap-3">
								<div class="flex min-w-0 flex-1 flex-col gap-1">
									<p class="flex items-center gap-2 text-sm font-semibold text-gray-50">
										{#if task.progress < 0.02}
											<LoaderCircle size={16} class="animate-spin text-blue-300" />
										{:else}
											<Download size={16} class="text-blue-300" />
										{/if}
										<span class="truncate">{task.title}</span>
									</p>
									{#if task.subtitle}
										<p class="truncate text-xs text-gray-400">{task.subtitle}</p>
									{/if}
									<div class="flex flex-wrap items-center gap-2 text-xs text-gray-400">
										<span>{formatTransferStatus(task.receivedBytes, task.totalBytes)}</span>
										<span aria-hidden="true">•</span>
										<span>{formatPercent(task.progress)}</span>
									</div>
								</div>
								<button
									onclick={() =>
										task.cancellable
											? downloadUiStore.cancelTrackDownload(task.id)
											: downloadUiStore.dismissTrackTask(task.id)}
									class="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
									aria-label={task.cancellable
										? `Cancel download for ${task.title}`
										: `Dismiss download for ${task.title}`}
								>
									<X size={16} />
								</button>
							</div>
							<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
								<div
									class="h-full rounded-full bg-blue-500 transition-all duration-200"
									style="width: {Math.min(Math.max(task.progress * 100, 4), 100)}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
		<div class="audio-player-glass overflow-hidden rounded-2xl border shadow-2xl">
			<div class="relative px-4 py-3">
				{#if $playerStore.currentTrack}
					<!-- Progress Bar -->
					<div class="mb-3">
						<button
							bind:this={seekBarElement}
							onmousedown={handleSeekStart}
							ontouchstart={handleSeekStart}
							class="group relative h-1 w-full cursor-pointer overflow-hidden rounded-full bg-gray-700"
							type="button"
							aria-label="Seek position"
						>
							<div
								class="pointer-events-none absolute inset-y-0 left-0 bg-blue-400/30 transition-all"
								style="width: {bufferedPercent}%"
								aria-hidden="true"
							></div>
							<div
								class="pointer-events-none absolute inset-y-0 left-0 bg-blue-500 transition-all"
								style="width: {getPercent($playerStore.currentTime, $playerStore.duration)}%"
								aria-hidden="true"
							></div>
							<div
								class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100"
								style="left: {getPercent($playerStore.currentTime, $playerStore.duration)}%"
								aria-hidden="true"
							></div>
						</button>
						<div class="mt-1 flex justify-between text-xs text-gray-400">
							<span>{formatTime($playerStore.currentTime)}</span>
							<span>{formatTime($playerStore.duration)}</span>
						</div>
					</div>

					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<!-- Track Info -->
						{#if $playerStore.currentTrack}
							<div class="flex min-w-0 items-center gap-3 sm:flex-1">
								{#if !('isSonglinkTrack' in $playerStore.currentTrack && $playerStore.currentTrack.isSonglinkTrack)}
									<!-- Only show album cover for regular tracks -->
									{#if $playerStore.currentTrack.album.videoCover}
										<video
											src={losslessAPI.getCoverUrl($playerStore.currentTrack.album.videoCover, '640')}
											autoplay
											loop
											muted
											playsinline
											class="h-16 w-16 flex-shrink-0 rounded-md object-cover"
										></video>
									{:else if $playerStore.currentTrack.album.cover}
										<img
											src={losslessAPI.getCoverUrl($playerStore.currentTrack.album.cover, '640')}
											alt={$playerStore.currentTrack.title}
											class="h-16 w-16 flex-shrink-0 rounded-md object-cover"
										/>
									{/if}
								{/if}
								<div class="min-w-0 flex-1">
									<h3 class="truncate font-semibold text-white">
										{$playerStore.currentTrack.title}
									</h3>
									{#if 'isSonglinkTrack' in $playerStore.currentTrack && $playerStore.currentTrack.isSonglinkTrack}
										<!-- Display for SonglinkTrack -->
										<p class="truncate text-sm text-gray-400">
											{$playerStore.currentTrack.artistName}
										</p>
									{:else}
										<!-- Display for regular Track -->
										<a
											href={`/artist/${$playerStore.currentTrack.artist.id}`}
											class="truncate text-sm text-gray-400 hover:text-blue-400 hover:underline inline-block"
											data-sveltekit-preload-data
										>
											{formatArtists($playerStore.currentTrack.artists)}
										</a>
										<p class="text-xs text-gray-500">
											<a
												href={`/album/${$playerStore.currentTrack.album.id}`}
												class="hover:text-blue-400 hover:underline"
												data-sveltekit-preload-data
											>
												{$playerStore.currentTrack.album.title}
											</a>
											{#if currentPlaybackQuality}
												<span class="mx-1" aria-hidden="true">•</span>
												<span>{formatQualityLabel(currentPlaybackQuality)}</span>
											{/if}
											{#if currentPlaybackQuality && $playerStore.currentTrack.audioQuality && currentPlaybackQuality !== $playerStore.currentTrack.audioQuality}
												<span class="mx-1 text-gray-600" aria-hidden="true">•</span>
												<span class="text-gray-500">
													({formatQualityLabel($playerStore.currentTrack.audioQuality)} available)
												</span>
											{/if}
											{#if sampleRateLabel}
												<span class="mx-1 text-gray-600" aria-hidden="true">•</span>
												<span>{sampleRateLabel}</span>
											{/if}
										</p>
									{/if}
								</div>
							</div>
						{/if}

						<div class="flex flex-nowrap items-center justify-between gap-2 sm:gap-4">
							<!-- Controls -->
							<div class="flex items-center justify-center gap-1 sm:gap-2">
								<button
									onclick={() => playerStore.previous()}
									class="p-1.5 sm:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
									disabled={$playerStore.queueIndex <= 0}
									aria-label="Previous track"
								>
									<SkipBack size={18} class="sm:w-5 sm:h-5" />
								</button>

								<button
									onclick={() => playerStore.togglePlay()}
									class="rounded-full bg-white p-2.5 sm:p-3 text-gray-900 transition-transform hover:scale-105"
									aria-label={$playerStore.isPlaying ? 'Pause' : 'Play'}
								>
									{#if $playerStore.isPlaying}
										<Pause size={20} class="sm:w-6 sm:h-6" fill="currentColor" />
									{:else}
										<Play size={20} class="sm:w-6 sm:h-6" fill="currentColor" />
									{/if}
								</button>

								<button
									onclick={() => playerStore.next()}
									class="p-1.5 sm:p-2 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
									disabled={$playerStore.queueIndex >= $playerStore.queue.length - 1}
									aria-label="Next track"
								>
									<SkipForward size={18} class="sm:w-5 sm:h-5" />
								</button>
							</div>

							<!-- Queue Toggle -->
							<div class="flex items-center gap-1 sm:gap-2">
								<button
									onclick={handleDownloadCurrentTrack}
									class="player-toggle-button p-1.5 sm:p-2"
									aria-label="Download current track"
									type="button"
									disabled={!$playerStore.currentTrack || isDownloadingCurrentTrack}
								>
									{#if isDownloadingCurrentTrack}
										<LoaderCircle size={16} class="sm:w-[18px] sm:h-[18px] animate-spin" />
									{:else}
										<Download size={16} class="sm:w-[18px] sm:h-[18px]" />
									{/if}
									<span class="hidden sm:inline">Download</span>
								</button>
								<button
									onclick={() => lyricsStore.toggle()}
									class="player-toggle-button p-1.5 sm:p-2 {$lyricsStore.open
										? 'player-toggle-button--active'
										: ''}"
									aria-label={$lyricsStore.open ? 'Hide lyrics popup' : 'Show lyrics popup'}
									aria-expanded={$lyricsStore.open}
									type="button"
								>
									<ScrollText size={16} class="sm:w-[18px] sm:h-[18px]" />
									<span class="hidden sm:inline">Lyrics</span>
								</button>
								<button
									onclick={toggleQueuePanel}
									class="player-toggle-button p-1.5 sm:p-2 {showQueuePanel
										? 'player-toggle-button--active'
										: ''}"
									aria-label="Toggle queue panel"
									aria-expanded={showQueuePanel}
									type="button"
								>
									<ListMusic size={16} class="sm:w-[18px] sm:h-[18px]" />
									<span class="hidden sm:inline">Queue ({$playerStore.queue.length})</span>
								</button>
							</div>

							<!-- Volume Control -->
							<div class="hidden sm:flex items-center gap-2">
								<button
									onclick={toggleMute}
									class="p-2 text-gray-400 transition-colors hover:text-white"
									aria-label={isMuted ? 'Unmute' : 'Mute'}
								>
									{#if isMuted || $playerStore.volume === 0}
										<VolumeX size={20} />
									{:else}
										<Volume2 size={20} />
									{/if}
								</button>
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={$playerStore.volume}
									oninput={handleVolumeChange}
									class="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-white"
									aria-label="Volume"
								/>
							</div>
						</div>
					</div>

					{#if showQueuePanel}
						<div
							class="queue-panel mt-4 space-y-3 rounded-2xl border p-4 text-sm shadow-inner"
							transition:slide={{ duration: 220, easing: cubicOut }}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2 text-gray-300">
									<ListMusic size={18} />
									<span class="font-medium">Playback Queue</span>
									<span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
										{$playerStore.queue.length}
									</span>
								</div>
								<div class="flex items-center gap-2">
									<button
										onclick={handleShuffleQueue}
										class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-blue-500 hover:text-blue-200 disabled:opacity-40"
										type="button"
										disabled={$playerStore.queue.length <= 1}
									>
										<Shuffle size={14} />
										Shuffle
									</button>
									<button
										onclick={clearQueue}
										class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-red-500 hover:text-red-400"
										type="button"
										disabled={$playerStore.queue.length === 0}
									>
										<Trash2 size={14} />
										Clear
									</button>
									<button
										onclick={closeQueuePanel}
										class="rounded-full p-1 text-gray-400 transition-colors hover:text-white"
										aria-label="Close queue panel"
									>
										<X size={16} />
									</button>
								</div>
							</div>

							{#if $playerStore.queue.length > 0}
								<ul class="max-h-60 space-y-2 overflow-y-auto pr-1">
									{#each $playerStore.queue as queuedTrack, index}
										<li>
											<div
												onclick={() => playFromQueue(index)}
												onkeydown={(event) => {
													if (event.key === 'Enter' || event.key === ' ') {
														event.preventDefault();
														playFromQueue(index);
													}
												}}
												tabindex="0"
												role="button"
												class="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors {index ===
												$playerStore.queueIndex
													? 'bg-blue-500/10 text-white'
													: 'text-gray-200 hover:bg-gray-800/70'}"
											>
												<span
													class="w-6 text-xs font-semibold text-gray-500 group-hover:text-gray-300"
												>
													{index + 1}
												</span>
												<div class="min-w-0 flex-1">
													<p class="truncate text-sm font-medium">
														{queuedTrack.title}
													</p>
													<a
														href={`/artist/${queuedTrack.artist.id}`}
														onclick={(e) => e.stopPropagation()}
														class="truncate text-xs text-gray-400 hover:text-blue-400 hover:underline inline-block"
														data-sveltekit-preload-data
													>
														{formatArtists(queuedTrack.artists)}
													</a>
												</div>
												<button
													onclick={(event) => removeFromQueue(index, event)}
													class="rounded-full p-1 text-gray-500 transition-colors hover:text-red-400"
													aria-label={`Remove ${queuedTrack.title} from queue`}
													type="button"
												>
													<X size={14} />
												</button>
											</div>
										</li>
									{/each}
								</ul>
							{:else}
								<p
									class="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 px-3 py-8 text-center text-gray-400"
								>
									Queue is empty
								</p>
							{/if}
						</div>
					{/if}

					{#if $playerStore.currentTrack && $playerStore.isLoading}
						<div class="loading-overlay">
							<div class="loading-equalizer" aria-hidden="true">
								<span class="bar" style="animation-delay: 0ms"></span>
								<span class="bar" style="animation-delay: 150ms"></span>
								<span class="bar" style="animation-delay: 300ms"></span>
								<span class="bar" style="animation-delay: 450ms"></span>
							</div>
							<p class="text-sm font-medium text-gray-200">Loading track…</p>
						</div>
					{/if}
				{:else}
					<div class="flex h-20 items-center justify-center text-sm text-gray-400">
						Nothing is playing
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.audio-player-glass {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 30px 80px rgba(2, 6, 23, 0.6),
			0 4px 18px rgba(15, 23, 42, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.queue-panel {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px))
			saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 8px 24px rgba(2, 6, 23, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.ffmpeg-banner {
		background: transparent;
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.7));
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 12px 32px rgba(2, 6, 23, 0.5),
			0 2px 8px rgba(59, 130, 246, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			inset 0 0 30px rgba(59, 130, 246, 0.08);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.download-popup {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 12px 32px rgba(2, 6, 23, 0.5),
			0 2px 8px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.audio-player-backdrop {
		isolation: isolate;
	}

	.audio-player-backdrop::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		mask: linear-gradient(to bottom, transparent 0%, black 25%);
	}

	.audio-player-backdrop > * {
		position: relative;
		z-index: 1;
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		cursor: pointer;
	}

	input[type='range']::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background: rgba(17, 24, 39, 0.65);
		backdrop-filter: blur(6px);
	}

	.loading-equalizer {
		display: flex;
		align-items: flex-end;
		gap: 0.4rem;
		height: 1.75rem;
	}

	.loading-equalizer .bar {
		width: 0.3rem;
		height: 0.6rem;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.85);
		animation: equalize 1s ease-in-out infinite;
	}

	@keyframes equalize {
		0% {
			opacity: 0.4;
			height: 0.5rem;
		}
		40% {
			opacity: 1;
			height: 1.7rem;
		}
		80% {
			opacity: 0.6;
			height: 0.8rem;
		}
		100% {
			opacity: 0.4;
			height: 0.5rem;
		}
	}

	/* Dynamic button styles */
	button.rounded-full {
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			color 0.2s ease,
			background 0.2s ease;
	}

	button.rounded-full:hover {
		border-color: var(--bloom-accent, rgba(59, 130, 246, 0.7)) !important;
	}

	/* Player toggle buttons (Lyrics, Queue) */
	.player-toggle-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 9999px;
		border: 1px solid rgba(148, 163, 184, 0.25);
		background: transparent;
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		color: rgba(209, 213, 219, 0.85);
		transition:
			border-color 200ms ease,
			color 200ms ease,
			box-shadow 200ms ease;
	}

	.player-toggle-button:hover {
		border-color: var(--bloom-accent, rgba(96, 165, 250, 0.6));
		color: rgba(255, 255, 255, 0.95);
	}

	.player-toggle-button--active {
		border-color: var(--bloom-accent, rgba(96, 165, 250, 0.7));
		color: rgba(255, 255, 255, 0.98);
		box-shadow: inset 0 0 20px rgba(96, 165, 250, 0.15);
	}
</style>
