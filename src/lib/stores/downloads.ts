import { writable, derived } from 'svelte/store';
import type { Track } from '$lib/types';

export interface FFmpegLoadState {
	status: 'idle' | 'countdown' | 'loading' | 'loaded' | 'error';
	countdown?: number; // seconds remaining
	progress?: number; // 0-100
	error?: string;
	sizeEstimateMB?: number;
}

export interface TrackDownloadState {
	trackId: number;
	track: Track;
	progress: number; // 0-100
	status: 'pending' | 'downloading' | 'processing' | 'complete' | 'error' | 'cancelled';
	error?: string;
	abortController?: AbortController;
}

interface DownloadsState {
	ffmpeg: FFmpegLoadState;
	trackDownloads: Map<number, TrackDownloadState>;
}

function createDownloadsStore() {
	const { subscribe, update } = writable<DownloadsState>({
		ffmpeg: {
			status: 'idle',
			sizeEstimateMB: 32 // Approximate FFmpeg WASM size
		},
		trackDownloads: new Map()
	});

	return {
		subscribe,
		
		// FFmpeg methods
		startFFmpegCountdown: () => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					status: 'countdown',
					countdown: 5
				}
			}));
		},
		
		updateFFmpegCountdown: (countdown: number) => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					countdown
				}
			}));
		},
		
		cancelFFmpegCountdown: () => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					status: 'idle',
					countdown: undefined
				}
			}));
		},
		
		startFFmpegLoading: () => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					status: 'loading',
					countdown: undefined,
					progress: 0
				}
			}));
		},
		
		updateFFmpegProgress: (progress: number) => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					progress
				}
			}));
		},
		
		setFFmpegLoaded: () => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					status: 'loaded',
					progress: 100
				}
			}));
		},
		
		setFFmpegError: (error: string) => {
			update(state => ({
				...state,
				ffmpeg: {
					...state.ffmpeg,
					status: 'error',
					error
				}
			}));
		},
		
		// Track download methods
		addTrackDownload: (trackId: number, track: Track, abortController?: AbortController) => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				newDownloads.set(trackId, {
					trackId,
					track,
					progress: 0,
					status: 'pending',
					abortController
				});
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		},
		
		updateTrackDownloadProgress: (trackId: number, progress: number) => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				const download = newDownloads.get(trackId);
				if (download) {
					newDownloads.set(trackId, {
						...download,
						progress,
						status: progress < 100 ? 'downloading' : download.status
					});
				}
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		},
		
		setTrackDownloadStatus: (trackId: number, status: TrackDownloadState['status']) => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				const download = newDownloads.get(trackId);
				if (download) {
					newDownloads.set(trackId, {
						...download,
						status
					});
				}
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		},
		
		setTrackDownloadError: (trackId: number, error: string) => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				const download = newDownloads.get(trackId);
				if (download) {
					newDownloads.set(trackId, {
						...download,
						status: 'error',
						error
					});
				}
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		},
		
		cancelTrackDownload: (trackId: number) => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				const download = newDownloads.get(trackId);
				if (download) {
					download.abortController?.abort();
					newDownloads.set(trackId, {
						...download,
						status: 'cancelled'
					});
				}
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		},
		
		removeTrackDownload: (trackId: number) => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				newDownloads.delete(trackId);
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		},
		
		clearCompletedDownloads: () => {
			update(state => {
				const newDownloads = new Map(state.trackDownloads);
				for (const [trackId, download] of newDownloads.entries()) {
					if (download.status === 'complete' || download.status === 'error' || download.status === 'cancelled') {
						newDownloads.delete(trackId);
					}
				}
				return {
					...state,
					trackDownloads: newDownloads
				};
			});
		}
	};
}

export const downloadsStore = createDownloadsStore();

// Derived store for active downloads
export const activeDownloads = derived(
	downloadsStore,
	$downloads => Array.from($downloads.trackDownloads.values()).filter(
		d => d.status === 'downloading' || d.status === 'pending' || d.status === 'processing'
	)
);

// Derived store to check if FFmpeg should be shown
export const shouldShowFFmpegBanner = derived(
	downloadsStore,
	$downloads => $downloads.ffmpeg.status === 'countdown' || $downloads.ffmpeg.status === 'loading'
);
