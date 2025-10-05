import { derived, get, writable } from 'svelte/store';
import type { Track } from '$lib/types';

export type FfmpegPhase = 'idle' | 'countdown' | 'loading' | 'ready' | 'error';

export interface FfmpegBannerState {
	phase: FfmpegPhase;
	countdownSeconds: number;
	totalBytes?: number;
	progress: number;
	dismissible: boolean;
	autoTriggered: boolean;
	error?: string;
	startedAt?: number;
	updatedAt?: number;
}

export type TrackDownloadStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

export interface TrackDownloadTask {
	id: string;
	trackId: number;
	title: string;
	subtitle?: string;
	filename: string;
	status: TrackDownloadStatus;
	receivedBytes: number;
	totalBytes?: number;
	progress: number;
	error?: string;
	startedAt: number;
	updatedAt: number;
	cancellable: boolean;
}

interface DownloadUiState {
	ffmpeg: FfmpegBannerState;
	tasks: TrackDownloadTask[];
}

const MAX_VISIBLE_TASKS = 4;
const COUNTDOWN_DEFAULT_SECONDS = 5;

const initialState: DownloadUiState = {
	ffmpeg: {
		phase: 'idle',
		countdownSeconds: COUNTDOWN_DEFAULT_SECONDS,
		totalBytes: undefined,
		progress: 0,
		dismissible: true,
		autoTriggered: true,
		startedAt: undefined,
		updatedAt: undefined
	},
	tasks: []
};

const store = writable<DownloadUiState>(initialState);

const taskControllers = new Map<string, AbortController>();
let countdownInterval: ReturnType<typeof setInterval> | null = null;

function nextTaskId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function clampProgress(value: number | null | undefined): number {
	if (!Number.isFinite(value ?? NaN)) return 0;
	return Math.max(0, Math.min(1, Number(value)));
}

function stopCountdownTicker() {
	if (countdownInterval) {
		clearInterval(countdownInterval);
		countdownInterval = null;
	}
}

function updateCountdownTicker() {
	stopCountdownTicker();
	countdownInterval = setInterval(() => {
		store.update((state) => {
			if (state.ffmpeg.phase !== 'countdown') {
				stopCountdownTicker();
				return state;
			}

			const nextSeconds = Math.max(0, state.ffmpeg.countdownSeconds - 1);
			const nextPhase: FfmpegPhase = nextSeconds === 0 ? 'loading' : 'countdown';
			return {
				...state,
				ffmpeg: {
					...state.ffmpeg,
					phase: nextPhase,
					countdownSeconds: nextSeconds,
					progress: 0,
					updatedAt: Date.now(),
					dismissible: nextPhase !== 'loading'
				}
			};
		});
	}, 1000);
}

function upsertTask(task: TrackDownloadTask): void {
	store.update((state) => {
		const existingIndex = state.tasks.findIndex((entry) => entry.id === task.id);
		const tasks = state.tasks.slice();
		if (existingIndex >= 0) {
			tasks[existingIndex] = { ...tasks[existingIndex]!, ...task, updatedAt: Date.now() };
		} else {
			tasks.unshift({ ...task, updatedAt: Date.now() });
		}
		return {
			...state,
			tasks: tasks.slice(0, MAX_VISIBLE_TASKS)
		};
	});
}

function mutateTask(id: string, updater: (task: TrackDownloadTask) => TrackDownloadTask): void {
	store.update((state) => {
		const index = state.tasks.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return state;
		}
		const tasks = state.tasks.slice();
		const nextTask = updater({ ...tasks[index]! });
		tasks[index] = { ...nextTask, updatedAt: Date.now() };
		return { ...state, tasks };
	});
}

function removeTask(id: string): void {
	store.update((state) => ({
		...state,
		tasks: state.tasks.filter((task) => task.id !== id)
	}));
	const controller = taskControllers.get(id);
	if (controller) {
		taskControllers.delete(id);
	}
}

export const downloadUiStore = {
	subscribe: store.subscribe,
	reset(): void {
		stopCountdownTicker();
		store.set(initialState);
		taskControllers.clear();
	},
	beginTrackDownload(track: Track, filename: string, options?: { subtitle?: string }): {
		taskId: string;
		controller: AbortController;
	} {
		const id = nextTaskId('track');
		const controller = new AbortController();
		taskControllers.set(id, controller);
		upsertTask({
			id,
			trackId: track.id,
			title: track.title,
			subtitle: options?.subtitle ?? track.artist?.name ?? 'Unknown artist',
			filename,
			status: 'running',
			receivedBytes: 0,
			totalBytes: undefined,
			progress: 0,
			error: undefined,
			startedAt: Date.now(),
			updatedAt: Date.now(),
			cancellable: true
		});
		return { taskId: id, controller };
	},
	updateTrackProgress(taskId: string, received: number, total?: number): void {
		mutateTask(taskId, (task) => ({
			...task,
			receivedBytes: received,
			totalBytes: total,
			progress: total ? clampProgress(received / total) : task.progress
		}));
	},
	updateTrackStage(taskId: string, progress: number): void {
		mutateTask(taskId, (task) => ({
			...task,
			progress: clampProgress(progress)
		}));
	},
	completeTrackDownload(taskId: string): void {
		const controller = taskControllers.get(taskId);
		if (controller) {
			taskControllers.delete(taskId);
		}
		mutateTask(taskId, (task) => ({
			...task,
			status: task.status === 'cancelled' ? 'cancelled' : 'completed',
			progress: task.status === 'cancelled' ? task.progress : 1,
			cancellable: false
		}));
	},
	errorTrackDownload(taskId: string, error: unknown): void {
		const controller = taskControllers.get(taskId);
		if (controller) {
			taskControllers.delete(taskId);
		}
		mutateTask(taskId, (task) => ({
			...task,
			status: 'error',
			error:
				error instanceof Error
					? error.message
					: typeof error === 'string'
						? error
						: 'Download failed',
			cancellable: false
		}));
	},
	cancelTrackDownload(taskId: string): void {
		const controller = taskControllers.get(taskId);
		if (controller) {
			controller.abort();
		}
		mutateTask(taskId, (task) => ({
			...task,
			status: 'cancelled',
			error: undefined,
			cancellable: false
		}));
	},
	dismissTrackTask(taskId: string): void {
		removeTask(taskId);
	},
	startFfmpegCountdown(totalBytes: number, options?: { autoTriggered?: boolean }): void {
		const autoTriggered = options?.autoTriggered ?? true;
		store.set({
			...get(store),
			ffmpeg: {
				phase: autoTriggered ? 'countdown' : 'loading',
				countdownSeconds: autoTriggered ? COUNTDOWN_DEFAULT_SECONDS : 0,
				totalBytes: totalBytes > 0 ? totalBytes : undefined,
				progress: 0,
				dismissible: autoTriggered,
				autoTriggered,
				error: undefined,
				startedAt: Date.now(),
				updatedAt: Date.now()
			}
		});
		if (autoTriggered) {
			updateCountdownTicker();
		} else {
			stopCountdownTicker();
		}
	},
	skipFfmpegCountdown(): void {
		store.update((state) => {
			if (state.ffmpeg.phase !== 'countdown') {
				return state;
			}
			stopCountdownTicker();
			return {
				...state,
				ffmpeg: {
					...state.ffmpeg,
					phase: 'loading',
					countdownSeconds: 0,
					progress: 0,
					dismissible: false,
					updatedAt: Date.now()
				}
			};
		});
	},
	startFfmpegLoading(): void {
		stopCountdownTicker();
		store.update((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'loading',
				countdownSeconds: 0,
				progress: 0,
				dismissible: false,
				updatedAt: Date.now()
			}
		}));
	},
	updateFfmpegProgress(progress: number): void {
		store.update((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'loading',
				progress: clampProgress(progress),
				dismissible: false,
				updatedAt: Date.now()
			}
		}));
	},
	completeFfmpeg(): void {
		stopCountdownTicker();
		store.update((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'ready',
				progress: 1,
				countdownSeconds: 0,
				dismissible: true,
				updatedAt: Date.now()
			}
		}));
	},
	errorFfmpeg(error: unknown): void {
		stopCountdownTicker();
		store.update((state) => ({
			...state,
			ffmpeg: {
				...state.ffmpeg,
				phase: 'error',
				progress: 0,
				dismissible: true,
				error:
					error instanceof Error
						? error.message
						: typeof error === 'string'
							? error
							: 'Failed to load FFmpeg',
				updatedAt: Date.now()
			}
		}));
	},
	dismissFfmpeg(): void {
		stopCountdownTicker();
		store.update((state) => ({
			...state,
			ffmpeg: {
				phase: 'idle',
				countdownSeconds: COUNTDOWN_DEFAULT_SECONDS,
				totalBytes: undefined,
				progress: 0,
				dismissible: true,
				autoTriggered: true,
				error: undefined,
				startedAt: undefined,
				updatedAt: Date.now()
			}
		}));
	}
};

export const activeTrackDownloads = derived(store, ($state) =>
	$state.tasks.filter((task) => task.status === 'running')
);

export const completedTrackDownloads = derived(store, ($state) =>
	$state.tasks.filter((task) => task.status === 'completed')
);

export const erroredTrackDownloads = derived(store, ($state) =>
	$state.tasks.filter((task) => task.status === 'error')
);

export const ffmpegBanner = derived(store, ($state) => $state.ffmpeg);
