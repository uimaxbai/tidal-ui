import { browser } from '$app/environment';
import { downloadsStore } from '$lib/stores/downloads';

const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm`;

type FFmpegClass = (typeof import('@ffmpeg/ffmpeg'))['FFmpeg'];
type FFmpegInstance = InstanceType<FFmpegClass>;
type FetchFileFn = (typeof import('@ffmpeg/util'))['fetchFile'];

let ffmpegInstance: FFmpegInstance | null = null;
let loadPromise: Promise<FFmpegInstance> | null = null;
let fetchFileFn: FetchFileFn | null = null;
let countdownIntervalId: ReturnType<typeof setInterval> | null = null;

async function ensureFFmpegClass(): Promise<FFmpegClass> {
	const module = await import('@ffmpeg/ffmpeg');
	return module.FFmpeg;
}

async function ensureFetchFile(): Promise<FetchFileFn> {
	if (fetchFileFn) return fetchFileFn;
	const module = await import('@ffmpeg/util');
	fetchFileFn = module.fetchFile;
	return fetchFileFn;
}

export function isFFmpegSupported(): boolean {
	return browser && typeof ReadableStream !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export async function getFFmpegWithCountdown(skipCountdown = false): Promise<FFmpegInstance> {
	if (!isFFmpegSupported()) {
		throw new Error('FFmpeg is not supported in this environment.');
	}

	if (ffmpegInstance) {
		return ffmpegInstance;
	}

	if (!loadPromise) {
		// Start countdown or skip to loading
		if (skipCountdown) {
			downloadsStore.startFFmpegLoading();
		} else {
			downloadsStore.startFFmpegCountdown();
			
			// Wait for countdown
			await new Promise<void>((resolve) => {
				let countdown = 5;
				countdownIntervalId = setInterval(() => {
					countdown--;
					downloadsStore.updateFFmpegCountdown(countdown);
					
					if (countdown <= 0) {
						if (countdownIntervalId) {
							clearInterval(countdownIntervalId);
							countdownIntervalId = null;
						}
						resolve();
					}
				}, 1000);
			});
			
			downloadsStore.startFFmpegLoading();
		}
		
		loadPromise = (async () => {
			try {
				const FFmpegConstructor = await ensureFFmpegClass();
				const instance = new FFmpegConstructor();
				
				// Set up progress tracking
				instance.on('log', ({ message }) => {
					console.debug('[FFmpeg]', message);
				});
				
				await instance.load({
					coreURL: `${CORE_BASE_URL}/ffmpeg-core.js`,
					wasmURL: `${CORE_BASE_URL}/ffmpeg-core.wasm`
				});
				
				ffmpegInstance = instance;
				downloadsStore.setFFmpegLoaded();
				
				// Hide banner after a short delay
				setTimeout(() => {
					downloadsStore.cancelFFmpegCountdown();
				}, 2000);
				
				return instance;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				downloadsStore.setFFmpegError(errorMessage);
				throw error;
			}
		})().catch((error) => {
			loadPromise = null;
			throw error;
		});
	}

	return loadPromise;
}

export async function getFFmpeg(): Promise<FFmpegInstance> {
	return getFFmpegWithCountdown(false);
}

export function cancelFFmpegCountdown() {
	if (countdownIntervalId) {
		clearInterval(countdownIntervalId);
		countdownIntervalId = null;
	}
	downloadsStore.cancelFFmpegCountdown();
	loadPromise = null;
}

export async function fetchFile(input: Parameters<FetchFileFn>[0]) {
	const fn = await ensureFetchFile();
	return fn(input);
}
