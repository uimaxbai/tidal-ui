import { browser } from '$app/environment';

const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm`;

type FFmpegClass = (typeof import('@ffmpeg/ffmpeg'))['FFmpeg'];
type FFmpegInstance = InstanceType<FFmpegClass>;
type FetchFileFn = (typeof import('@ffmpeg/util'))['fetchFile'];

let ffmpegInstance: FFmpegInstance | null = null;
let loadPromise: Promise<FFmpegInstance> | null = null;
let fetchFileFn: FetchFileFn | null = null;

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

export async function getFFmpeg(): Promise<FFmpegInstance> {
	if (!isFFmpegSupported()) {
		throw new Error('FFmpeg is not supported in this environment.');
	}

	if (ffmpegInstance) {
		return ffmpegInstance;
	}

	if (!loadPromise) {
		loadPromise = (async () => {
			const FFmpegConstructor = await ensureFFmpegClass();
			const instance = new FFmpegConstructor();
			await instance.load({
				coreURL: `${CORE_BASE_URL}/ffmpeg-core.js`,
				wasmURL: `${CORE_BASE_URL}/ffmpeg-core.wasm`
			});
			ffmpegInstance = instance;
			return instance;
		})().catch((error) => {
			loadPromise = null;
			throw error;
		});
	}

	return loadPromise;
}

export async function fetchFile(input: Parameters<FetchFileFn>[0]) {
	const fn = await ensureFetchFile();
	return fn(input);
}
