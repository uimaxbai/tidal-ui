<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { playerStore } from '$lib/stores/player';
	import { losslessAPI } from '$lib/api';
	import {
		extractPaletteFromImage,
		darken,
		lighten,
		rgbToCss,
		ensureTextContrast,
		type PaletteResult,
		type RGBColor
	} from '$lib/utils/colorPalette';

	type Theme = {
		primary: string;
		secondary: string;
		accent: string;
		surface: string;
		border: string;
		highlight: string;
		glow: string;
		tertiary: string;
		quaternary: string;
	};

	const DEFAULT_THEME: Theme = {
		primary: '#0f172a',
		secondary: '#1e293b',
		accent: '#3b82f6',
		surface: 'rgba(15, 23, 42, 0.95)',
		border: 'rgba(148, 163, 184, 0.18)',
		highlight: 'rgba(96, 165, 250, 0.45)',
		glow: 'rgba(59, 130, 246, 0.35)',
		tertiary: 'rgba(99, 102, 241, 0.32)',
		quaternary: 'rgba(30, 64, 175, 0.28)'
	};

	const DEFAULT_PALETTE: PaletteResult = {
		dominant: { red: 15, green: 23, blue: 42 },
		accent: { red: 59, green: 130, blue: 246 },
		palette: [
			{ red: 30, green: 41, blue: 59 },
			{ red: 59, green: 130, blue: 246 },
			{ red: 99, green: 102, blue: 241 }
		]
	};

	const toTheme = (palette: PaletteResult): Theme => {
		const dominant = ensureTextContrast(palette.dominant);
		const accent = ensureTextContrast(palette.accent);
		const secondary = ensureTextContrast(palette.palette[1] ?? lighten(dominant, 0.08));
		const glow = ensureTextContrast(palette.palette[2] ?? lighten(accent, 0.2));
		const tertiary = ensureTextContrast(palette.palette[3] ?? darken(accent, 0.15));
		const quaternary = ensureTextContrast(palette.palette[4] ?? lighten(dominant, 0.12));

		return {
			primary: rgbToCss(darken(dominant, 0.25)),
			secondary: rgbToCss(lighten(secondary, 0.12)),
			accent: rgbToCss(lighten(accent, 0.08)),
			surface: rgbToCss(lighten(dominant, 0.05), 0.95),
			border: rgbToCss(lighten(dominant, 0.4), 0.18),
			highlight: rgbToCss(lighten(accent, 0.25), 0.45),
			glow: rgbToCss(glow, 0.38),
			tertiary: rgbToCss(tertiary, 0.32),
			quaternary: rgbToCss(quaternary, 0.28)
		};
	};

	let theme: Theme = DEFAULT_THEME;
	let isPlaying = false;
	let requestToken = 0;
	let latestState: PlayerStateShape = { currentTrack: null, isPlaying: false };
	let currentCoverUrl: string | null = null;
	let retryAttempts = 0;

	const MAX_RETRY_ATTEMPTS = 3;
	const RETRY_DELAY_MS = 600;

	const setCssVariables = (next: Theme) => {
		if (!browser) return;
		const target = document.documentElement;
		target.style.setProperty('--bloom-primary', next.primary);
		target.style.setProperty('--bloom-secondary', next.secondary);
		target.style.setProperty('--bloom-accent', next.accent);
		target.style.setProperty('--bloom-glow', next.glow);
		target.style.setProperty('--bloom-tertiary', next.tertiary);
		target.style.setProperty('--bloom-quaternary', next.quaternary);
		target.style.setProperty('--surface-color', next.surface);
		target.style.setProperty('--surface-border', next.border);
		target.style.setProperty('--surface-highlight', next.highlight);
		target.style.setProperty('--accent-color', next.accent);
	};

	const applyTheme = (palette: PaletteResult) => {
		theme = toTheme(palette);
		setCssVariables(theme);
	};

	const resetTheme = () => {
		theme = DEFAULT_THEME;
		setCssVariables(theme);
	};

	const resolveArtworkUrl = (
		track: PlayerStateShape['currentTrack']
	): string | null => {
		if (!track) return null;

		const albumCover = track.album?.cover ?? null;
		if (albumCover) {
			return losslessAPI.getCoverUrl(albumCover, '1280');
		}

		const artistPicture = track.artist?.picture ?? track.artists?.find((artist) => Boolean(artist?.picture))?.picture ?? null;
		if (artistPicture) {
			return losslessAPI.getArtistPictureUrl(artistPicture, '750');
		}

		return null;
	};

	const updateFromTrack = async (state: PlayerStateShape | null = null) => {
		const snapshot = state ?? latestState;
		const token = ++requestToken;

		if (!snapshot?.currentTrack) {
			resetTheme();
			currentCoverUrl = null;
			retryAttempts = 0;
			return;
		}

		const coverUrl = resolveArtworkUrl(snapshot.currentTrack);

		if (!coverUrl) {
			resetTheme();
			currentCoverUrl = null;
			retryAttempts = 0;
			return;
		}

		if (coverUrl === currentCoverUrl) {
			return;
		}

		currentCoverUrl = coverUrl;
		retryAttempts = 0;

		try {
			const palette = await extractPaletteFromImage(coverUrl);
			if (token === requestToken) {
				applyTheme(palette);
			}
		} catch (error) {
			console.warn('Failed to extract palette from cover art', error);
			if (token === requestToken) {
				currentCoverUrl = null;
				retryAttempts += 1;
				resetTheme();
				if (retryAttempts <= MAX_RETRY_ATTEMPTS) {
					setTimeout(() => {
						updateFromTrack();
					}, RETRY_DELAY_MS);
				} else {
					retryAttempts = 0;
				}
			}
		}
	};

	let unsubscribe: () => void = () => {};
	let lastProcessedCover: string | null = null;

	const handlePlayerChange = (state: PlayerStateShape) => {
		latestState = state;
		isPlaying = state.isPlaying && Boolean(state.currentTrack);
		
		// Get the cover URL that would be processed
		const coverUrl = state.currentTrack ? resolveArtworkUrl(state.currentTrack) : null;
		
		// Skip if we're already processing or have processed this exact cover
		if (coverUrl === lastProcessedCover) {
			return;
		}
		
		lastProcessedCover = coverUrl;
		updateFromTrack(state);
	};

	type PlayerStateShape = {
		currentTrack: {
			album?: {
				cover?: string | null;
				videoCover?: string | null;
			};
			artist?: {
				picture?: string | null;
			} | null;
			artists?: Array<{
				picture?: string | null;
			}> | null;
		} | null;
		isPlaying: boolean;
	};

	const subscribeToPlayer = () => {
		unsubscribe = playerStore.subscribe(($state) => {
			const snapshot: PlayerStateShape = {
				currentTrack: $state.currentTrack
					? {
						album: {
							cover: $state.currentTrack.album?.cover ?? null,
							videoCover: $state.currentTrack.album?.videoCover ?? null
						},
						artist: $state.currentTrack.artist
							? {
								picture: $state.currentTrack.artist.picture ?? null
							}
							: null,
						artists: $state.currentTrack.artists?.map((artist) => ({
							picture: artist.picture ?? null
						})) ?? null
					}
					: null,
				isPlaying: $state.isPlaying
			};
			handlePlayerChange(snapshot);
		});
	};

	onMount(() => {
		if (!browser) return;
		setCssVariables(theme);
		
		// Get current state before subscribing
		const currentState = get(playerStore);
		if (currentState.currentTrack) {
			const snapshot: PlayerStateShape = {
				currentTrack: {
					album: {
						cover: currentState.currentTrack.album?.cover ?? null,
						videoCover: currentState.currentTrack.album?.videoCover ?? null
					},
					artist: currentState.currentTrack.artist
						? {
							picture: currentState.currentTrack.artist.picture ?? null
						}
						: null,
					artists: currentState.currentTrack.artists?.map((artist) => ({
						picture: artist.picture ?? null
					})) ?? null
				},
				isPlaying: currentState.isPlaying
			};
			
			// Mark this cover as being processed so subscription doesn't duplicate
			lastProcessedCover = resolveArtworkUrl(snapshot.currentTrack);
			latestState = snapshot;
			isPlaying = snapshot.isPlaying && Boolean(snapshot.currentTrack);
			updateFromTrack(snapshot);
		}
		
		// Subscribe after handling initial state
		subscribeToPlayer();
	});

	onDestroy(() => {
		unsubscribe?.();
	});
</script>

<div class={`dynamic-background ${isPlaying ? 'playing' : ''}`} aria-hidden="true">
	<div class="dynamic-background__gradient"></div>
	<div class="dynamic-background__vignette"></div>
	<div class="dynamic-background__noise"></div>
</div>

<style>
	.dynamic-background {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.dynamic-background__gradient {
		position: absolute;
		inset: -25vmax;
		background:
			radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--bloom-accent) 90%, transparent) 0%, transparent 60%),
			radial-gradient(circle at 80% 30%, color-mix(in srgb, var(--bloom-secondary) 95%, transparent) 0%, transparent 65%),
			radial-gradient(circle at 50% 80%, color-mix(in srgb, var(--bloom-primary) 85%, transparent) 0%, transparent 70%),
			radial-gradient(circle at 65% 50%, color-mix(in srgb, var(--bloom-tertiary, var(--bloom-accent)) 75%, transparent) 0%, transparent 55%),
			radial-gradient(circle at 30% 60%, color-mix(in srgb, var(--bloom-quaternary, var(--bloom-secondary)) 80%, transparent) 0%, transparent 58%);
		filter: blur(90px) saturate(130%);
		transform-origin: center;
		animation: bloom-rotate 60s ease-in-out infinite;
		animation-play-state: paused;
		transition: background 1.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.dynamic-background.playing .dynamic-background__gradient {
		animation-play-state: running;
	}

	.dynamic-background__vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at center, transparent 40%, rgba(8, 11, 19, 0.82) 100%);
	}

	.dynamic-background__noise {
		position: absolute;
		inset: 0;
		background-image: url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"%3E%3Cfilter id="n" x="0" y="0" width="100%25" height="100%25"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="128" height="128" filter="url(%23n)" opacity="0.18"/%3E%3C/svg%3E');
		mix-blend-mode: soft-light;
		opacity: 0.5;
	}

	@keyframes bloom-rotate {
		0% {
			transform: rotate(0deg) scale(1.08);
		}

		25% {
			transform: rotate(90deg) scale(1.06);
		}

		50% {
			transform: rotate(180deg) scale(1.08);
		}

		75% {
			transform: rotate(270deg) scale(1.06);
		}

		100% {
			transform: rotate(360deg) scale(1.08);
		}
	}
</style>
