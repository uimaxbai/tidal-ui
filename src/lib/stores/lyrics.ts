import { derived, get, writable } from 'svelte/store';
import type { Track } from '$lib/types';
import { currentTrack as currentTrackStore } from '$lib/stores/player';
import { fetchYouLyLyrics, type LyricsPayload } from '$lib/lyrics/youly';

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-found';

export interface LyricsState {
	open: boolean;
	maximized: boolean;
	status: LyricsStatus;
	track: Track | null;
	data: LyricsPayload | null;
	error: string | null;
	updatedAt: number | null;
}

const initialState: LyricsState = {
	open: false,
	maximized: false,
	status: 'idle',
	track: null,
	data: null,
	error: null,
	updatedAt: null
};

const FAILURE_RETRY_COOLDOWN_MS = 15_000;

function createLyricsStore() {
	const store = writable<LyricsState>({ ...initialState });

	let currentTrack: Track | null = null;
	let activeController: AbortController | null = null;
	let requestToken = 0;
	let lastSuccessfulTrackId: number | null = null;
	const failureTimestamps = new Map<number, number>();

	currentTrackStore.subscribe((track) => {
		currentTrack = track ?? null;
		const previousState = get(store);
		const previousTrackId = previousState.track?.id ?? null;
		const nextTrackId = track?.id ?? null;
		const trackChanged = previousTrackId !== nextTrackId;

		if (!trackChanged) {
			return;
		}

		store.update((state) => ({
			...state,
			track: currentTrack,
			data: state.open ? null : state.data,
			status: state.open && track ? 'loading' : state.open ? state.status : 'idle',
			error: null
		}));

		if (track && previousState.open) {
			void loadLyrics(track, { forceReload: false, preserveData: false });
		}
	});

	async function loadLyrics(
		track: Track,
		options: { forceReload?: boolean; preserveData?: boolean } = {}
	) {
		if (!track) return;

		const trackId = track.id;
		const now = Date.now();
		const state = get(store);
		const hasExistingData =
			!options.forceReload &&
			state.data !== null &&
			state.track?.id === trackId &&
			state.status === 'ready';

		if (hasExistingData) {
			return;
		}

		if (!options.forceReload) {
			const lastFailure = failureTimestamps.get(trackId);
			if (lastFailure && now - lastFailure < FAILURE_RETRY_COOLDOWN_MS) {
				return;
			}
			if (lastSuccessfulTrackId === trackId && state.status === 'ready') {
				return;
			}
		}

		if (activeController) {
			activeController.abort();
		}

		const controller = new AbortController();
		activeController = controller;
		const token = ++requestToken;

		store.update((state) => ({
			...state,
			status: 'loading',
			error: null,
			track,
			data: options.preserveData ? state.data : null
		}));

		try {
			const payload = await fetchYouLyLyrics(track, {
				signal: controller.signal,
				forceReload: options.forceReload ?? false
			});

			if (token !== requestToken) {
				return;
			}

			store.update((state) => {
				if (!payload || payload.lines.length === 0) {
					return {
						...state,
						status: 'not-found',
						data: null,
						error: null,
						updatedAt: Date.now()
					};
				}

				return {
					...state,
					status: 'ready',
					data: payload,
					error: null,
					updatedAt: Date.now()
				};
			});
			lastSuccessfulTrackId = trackId;
			failureTimestamps.delete(trackId);
		} catch (error) {
			if (token !== requestToken) {
				return;
			}

			if (error instanceof DOMException && error.name === 'AbortError') {
				return;
			}

			const message = error instanceof Error ? error.message : 'Unable to load lyrics';
			store.update((state) => ({
				...state,
				status: 'error',
				error: message,
				data: null
			}));
			failureTimestamps.set(trackId, Date.now());
		} finally {
			if (controller === activeController) {
				activeController = null;
			}
		}
	}

	function open(track?: Track | null) {
		const targetTrack = track ?? currentTrack;
		store.update((state) => ({
			...state,
			open: true,
			status: targetTrack ? state.status : 'idle',
			track: targetTrack ?? state.track
		}));

		if (targetTrack) {
			const state = get(store);
			const hasDataForTrack =
				state.data !== null && state.track?.id === targetTrack.id && state.status === 'ready';
			if (!hasDataForTrack) {
				void loadLyrics(targetTrack, { preserveData: !!state.data });
			}
		}
	}

	function close() {
		if (activeController) {
			activeController.abort();
			activeController = null;
		}

		store.update((state) => ({
			...state,
			open: false,
			maximized: false,
			status: 'idle'
		}));
	}

	function toggle() {
		const state = get(store);
		if (state.open) {
			close();
		} else {
			open();
		}
	}

	function toggleMaximize() {
		store.update((state) => ({
			...state,
			maximized: !state.maximized
		}));
	}

	function refresh() {
		const state = get(store);
		if (state.track) {
			void loadLyrics(state.track, { forceReload: true });
		}
	}

	return {
		subscribe: store.subscribe,
		open,
		close,
		toggle,
		toggleMaximize,
		refresh,
		loadLyrics: (track: Track) => loadLyrics(track, { forceReload: false })
	};
}

export const lyricsStore = createLyricsStore();

export const hasLyrics = derived(lyricsStore, ($state) => $state.data !== null);
