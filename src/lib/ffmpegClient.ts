import { browser } from '$app/environment';

const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm`;

type FFmpegClass = (typeof import('@ffmpeg/ffmpeg'))['FFmpeg'];
type FFmpegInstance = InstanceType<FFmpegClass>;
type FetchFileFn = (typeof import('@ffmpeg/util'))['fetchFile'];

const CORE_JS_NAME = 'ffmpeg-core.js';
const CORE_WASM_NAME = 'ffmpeg-core.wasm';

export interface FfmpegLoadProgress {
	receivedBytes: number;
	totalBytes?: number;
}

export interface FfmpegLoadOptions {
	signal?: AbortSignal;
	onProgress?: (progress: FfmpegLoadProgress) => void;
}

let ffmpegInstance: FFmpegInstance | null = null;
let loadPromise: Promise<FFmpegInstance> | null = null;
let fetchFileFn: FetchFileFn | null = null;
let assetsPromise: Promise<{ coreUrl: string; wasmUrl: string; totalBytes?: number }> | null = null;
let estimatedSizePromise: Promise<number | undefined> | null = null;

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

async function fetchHeadSize(path: string): Promise<number | undefined> {
	try {
		const response = await fetch(`${CORE_BASE_URL}/${path}`, { method: 'HEAD' });
		if (!response.ok) return undefined;
		const length = response.headers.get('Content-Length');
		if (!length) return undefined;
		const numeric = Number(length);
		return Number.isFinite(numeric) ? numeric : undefined;
	} catch (error) {
		console.debug('Failed to probe FFmpeg asset size', error);
		return undefined;
	}
}

async function streamAsset(
	path: string,
	options?: FfmpegLoadOptions,
	context?: {
		zTotalKnown?: number;
		onChunk?: (bytes: number) => void;
	}
): Promise<{ url: string; size: number | undefined }> {
	const response = await fetch(`${CORE_BASE_URL}/${path}`, {
		signal: options?.signal
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch ${path} (${response.status})`);
	}

	const totalBytes = Number(response.headers.get('Content-Length') ?? '0');
	const resolvedTotal = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : context?.zTotalKnown;

	if (!response.body) {
		const blob = await response.blob();
		const size = blob.size > 0 ? blob.size : resolvedTotal;
		return {
			url: URL.createObjectURL(blob),
			size
		};
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			context?.onChunk?.(value.byteLength);
		}
	}

	const blob = new Blob(chunks as BlobPart[], {
		type: response.headers.get('Content-Type') ?? 'application/octet-stream'
	});
	return {
		url: URL.createObjectURL(blob),
		size: blob.size > 0 ? blob.size : resolvedTotal
	};
}

async function ensureAssets(options?: FfmpegLoadOptions) {
	if (assetsPromise) {
		return assetsPromise;
	}

	assetsPromise = (async () => {
		const [jsSize, wasmSize] = await Promise.all([
			fetchHeadSize(CORE_JS_NAME),
			fetchHeadSize(CORE_WASM_NAME)
		]);
		const totalKnown = [jsSize, wasmSize]
			.map((value) => (Number.isFinite(value ?? NaN) ? Number(value) : 0))
			.reduce((sum, value) => sum + value, 0);

		let cumulative = 0;
		const notify = (bytes: number) => {
			cumulative += bytes;
			if (options?.onProgress) {
				options.onProgress({
					receivedBytes: cumulative,
					totalBytes: totalKnown > 0 ? totalKnown : undefined
				});
			}
		};

		const { url: coreUrl, size: fetchedJsSize } = await streamAsset(
			CORE_JS_NAME,
			options,
			{
				zTotalKnown: totalKnown > 0 ? totalKnown : undefined,
				onChunk: notify
			}
		);
		const { url: wasmUrl, size: fetchedWasmSize } = await streamAsset(
			CORE_WASM_NAME,
			options,
			{
				zTotalKnown: totalKnown > 0 ? totalKnown : undefined,
				onChunk: notify
			}
		);

		const totalBytes = [jsSize ?? fetchedJsSize, wasmSize ?? fetchedWasmSize]
			.filter((value): value is number => Number.isFinite(value ?? NaN))
			.reduce((sum, value) => sum + value, 0);

		return {
			coreUrl,
			wasmUrl,
			totalBytes: totalBytes > 0 ? totalBytes : undefined
		};
	})().catch((error) => {
		assetsPromise = null;
		throw error;
	});

	return assetsPromise;
}

export async function estimateFfmpegDownloadSize(): Promise<number | undefined> {
	if (!estimatedSizePromise) {
		estimatedSizePromise = (async () => {
			const [jsSize, wasmSize] = await Promise.all([
				fetchHeadSize(CORE_JS_NAME),
				fetchHeadSize(CORE_WASM_NAME)
			]);
			const total = [jsSize, wasmSize]
				.filter((value): value is number => Number.isFinite(value ?? NaN))
				.reduce((sum, value) => sum + value, 0);
			return total > 0 ? total : undefined;
		})();
	}
	return estimatedSizePromise ?? Promise.resolve(undefined);
}

export function isFFmpegSupported(): boolean {
	return browser && typeof ReadableStream !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export async function getFFmpeg(options?: FfmpegLoadOptions): Promise<FFmpegInstance> {
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
			const assets = await ensureAssets(options);
			await instance.load({
				coreURL: assets.coreUrl,
				wasmURL: assets.wasmUrl
			});
			ffmpegInstance = instance;
			URL.revokeObjectURL(assets.coreUrl);
			URL.revokeObjectURL(assets.wasmUrl);
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
