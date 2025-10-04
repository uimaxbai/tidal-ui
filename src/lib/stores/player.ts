// Audio player store for managing playback state
import { writable, derived } from 'svelte/store';
import type { Track, AudioQuality } from '$lib/types';

interface PlayerState {
	currentTrack: Track | null;
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	quality: AudioQuality;
	isLoading: boolean;
	queue: Track[];
	queueIndex: number;
}

const initialState: PlayerState = {
	currentTrack: null,
	isPlaying: false,
	currentTime: 0,
	duration: 0,
	volume: 0.8,
	quality: 'LOSSLESS',
	isLoading: false,
	queue: [],
	queueIndex: -1
};

function createPlayerStore() {
	const { subscribe, set, update } = writable<PlayerState>(initialState);

	return {
		subscribe,
		setTrack: (track: Track) =>
			update((state) => ({
				...state,
				currentTrack: track,
				duration: track.duration,
				isLoading: true
			})),
		play: () => update((state) => ({ ...state, isPlaying: true })),
		pause: () => update((state) => ({ ...state, isPlaying: false })),
		togglePlay: () => update((state) => ({ ...state, isPlaying: !state.isPlaying })),
		setCurrentTime: (time: number) => update((state) => ({ ...state, currentTime: time })),
		setDuration: (duration: number) => update((state) => ({ ...state, duration })),
		setVolume: (volume: number) => update((state) => ({ ...state, volume })),
		setQuality: (quality: AudioQuality) => update((state) => ({ ...state, quality })),
		setLoading: (isLoading: boolean) => update((state) => ({ ...state, isLoading })),
		setQueue: (queue: Track[], startIndex: number = 0) =>
			update((state) => ({
				...state,
				queue,
				queueIndex: startIndex,
				currentTrack: queue[startIndex] || null,
				isPlaying: queue.length > 0 ? state.isPlaying : false,
				isLoading: queue.length > 0,
				currentTime: queue.length > 0 ? state.currentTime : 0
			})),
		enqueue: (track: Track) =>
			update((state) => {
				const queue = state.queue.slice();
				if (queue.length === 0) {
					return {
						...state,
						queue: [track],
						queueIndex: 0,
						currentTrack: track,
						isPlaying: true,
						isLoading: true,
						currentTime: 0,
						duration: track.duration
					};
				}

				queue.push(track);
				return {
					...state,
					queue
				};
			}),
		enqueueNext: (track: Track) =>
			update((state) => {
				const queue = state.queue.slice();
				let queueIndex = state.queueIndex;
				if (queue.length === 0 || queueIndex === -1) {
					return {
						...state,
						queue: [track],
						queueIndex: 0,
						currentTrack: track,
						isPlaying: true,
						isLoading: true,
						currentTime: 0,
						duration: track.duration
					};
				}

				const insertIndex = Math.min(queueIndex + 1, queue.length);
				queue.splice(insertIndex, 0, track);
				if (insertIndex <= queueIndex) {
					queueIndex += 1;
				}
				return {
					...state,
					queue,
					queueIndex
				};
			}),
		next: () =>
			update((state) => {
				if (state.queueIndex < state.queue.length - 1) {
					const newIndex = state.queueIndex + 1;
					return {
						...state,
						queueIndex: newIndex,
						currentTrack: state.queue[newIndex],
						currentTime: 0
					};
				}
				return state;
			}),
		previous: () =>
			update((state) => {
				if (state.queueIndex > 0) {
					const newIndex = state.queueIndex - 1;
					return {
						...state,
						queueIndex: newIndex,
						currentTrack: state.queue[newIndex],
						currentTime: 0
					};
				}
				return state;
			}),
		playAtIndex: (index: number) =>
			update((state) => {
				if (index < 0 || index >= state.queue.length) {
					return state;
				}

				return {
					...state,
					queueIndex: index,
					currentTrack: state.queue[index],
					currentTime: 0,
					isPlaying: true,
					isLoading: true,
					duration: state.queue[index].duration
				};
			}),
		removeFromQueue: (index: number) =>
			update((state) => {
				if (index < 0 || index >= state.queue.length) {
					return state;
				}

				const queue = state.queue.slice();
				queue.splice(index, 1);
				let queueIndex = state.queueIndex;
				let currentTrack = state.currentTrack;
				let isPlaying = state.isPlaying;
				let currentTime = state.currentTime;
				let duration = state.duration;
				let isLoading = state.isLoading;

				if (queue.length === 0) {
					return {
						...state,
						queue,
						queueIndex: -1,
						currentTrack: null,
						isPlaying: false,
						isLoading: false,
						currentTime: 0,
						duration: 0
					};
				}

				if (index < queueIndex) {
					queueIndex -= 1;
				} else if (index === queueIndex) {
					if (queueIndex >= queue.length) {
						queueIndex = queue.length - 1;
					}
					currentTrack = queue[queueIndex] ?? null;
					currentTime = 0;
					duration = currentTrack?.duration ?? 0;
					if (!currentTrack) {
						isPlaying = false;
						isLoading = false;
					} else {
						isLoading = true;
					}
				}

				return {
					...state,
					queue,
					queueIndex,
					currentTrack,
					isPlaying,
					isLoading,
					currentTime,
					duration
				};
			}),
		clearQueue: () =>
			update((state) => ({
				...state,
				queue: [],
				queueIndex: -1,
				currentTrack: null,
				isPlaying: false,
				isLoading: false,
				currentTime: 0,
				duration: 0
			})),
		reset: () => set(initialState)
	};
}

export const playerStore = createPlayerStore();

// Derived stores for convenience
export const currentTrack = derived(playerStore, ($store) => $store.currentTrack);
export const isPlaying = derived(playerStore, ($store) => $store.isPlaying);
export const currentTime = derived(playerStore, ($store) => $store.currentTime);
export const duration = derived(playerStore, ($store) => $store.duration);
export const volume = derived(playerStore, ($store) => $store.volume);
export const progress = derived(playerStore, ($store) =>
	$store.duration > 0 ? ($store.currentTime / $store.duration) * 100 : 0
);
