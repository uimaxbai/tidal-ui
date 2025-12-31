<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { playerStore } from '$lib/stores/player';
	import { effectivePerformanceLevel, animationsEnabled } from '$lib/stores/performance';
	import { losslessAPI } from '$lib/api';
	import {
		extractPaletteFromImageWebGL,
		type RGBColor
	} from '$lib/utils/colorPalette';

	// WebGL constants
	const MASTER_PALETTE_SIZE = 40;
	const MASTER_PALETTE_TEX_WIDTH = 8;
	const MASTER_PALETTE_TEX_HEIGHT = 5;
	const DISPLAY_GRID_WIDTH = 8;
	const DISPLAY_GRID_HEIGHT = 5;
	const STRETCHED_GRID_WIDTH = 32;
	const STRETCHED_GRID_HEIGHT = 18;
	const BLUR_DOWNSAMPLE_FACTOR = 26;
	const CANVAS_SIZE = 512;
	const SONG_PALETTE_TRANSITION_SPEED = 0.003; // Even slower transition (was 0.006)
	const SCROLL_SPEED = 0.0005; // Much slower scroll (was 0.002)

	// WebGL state
	let webglCanvas: HTMLCanvasElement;
	let gl: WebGLRenderingContext | null = null;
	let glProgram: WebGLProgram | null = null;
	let updateStateProgram: WebGLProgram | null = null;
	let blurProgram: WebGLProgram | null = null;
	
	let currentTargetMasterPalette = $state<RGBColor[]>([]);
	let previousMasterPalette: RGBColor[] = [];
	let songPaletteTransitionProgress = 1.0;
	let scrollOffset = 0;
	let globalAnimationId: number | null = null;
	let lastFrameTime = 0;
	
	// Textures and framebuffers
	let cellStateTexture: WebGLTexture | null = null;
	let cellStateFramebuffer: WebGLFramebuffer | null = null;
	let paletteTexture: WebGLTexture | null = null;
	let colorRenderTexture: WebGLTexture | null = null;
	let colorRenderFramebuffer: WebGLFramebuffer | null = null;
	let blurTexture1: WebGLTexture | null = null;
	let blurFramebuffer1: WebGLFramebuffer | null = null;
	let blurTexture2: WebGLTexture | null = null;
	let blurFramebuffer2: WebGLFramebuffer | null = null;

	let isPlaying = $state(false);
	let enableAnimations = $state(true);
	let performanceLevel = $state<'high' | 'medium' | 'low'>(get(effectivePerformanceLevel));
	let backgroundEnabled = $state(performanceLevel !== 'low');
	let requestToken = 0;
	let latestState: PlayerStateShape = { currentTrack: null, isPlaying: false };
	let currentCoverUrl: string | null = null;
	let retryAttempts = 0;
	let canvasVisible = $state(false);
	let webglListenersAttached = false;

	const MAX_RETRY_ATTEMPTS = 3;
	const RETRY_DELAY_MS = 600;

	const setCssVariables = (mostVibrantColor: RGBColor) => {
		if (!browser) return;
		const target = document.documentElement;
		
		// Set lyrics palette color with boosted saturation
		const [h, s, l] = rgbToHsl(mostVibrantColor.red, mostVibrantColor.green, mostVibrantColor.blue);
		const boostedSat = Math.min(1.0, s * 1.2);
		const [r, g, b] = hslToRgb(h, boostedSat, l);
		
		target.style.setProperty('--lyplus-lyrics-palette', `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`);
	};

	const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0;
		let s = 0;
		const l = (max + min) / 2;

		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch (max) {
				case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
				case g: h = ((b - r) / d + 2) / 6; break;
				case b: h = ((r - g) / d + 4) / 6; break;
			}
		}
		return [h, s, l];
	};

	const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
		let r: number, g: number, b: number;
		if (s === 0) {
			r = g = b = l;
		} else {
			const hue2rgb = (p: number, q: number, t: number) => {
				if (t < 0) t += 1;
				if (t > 1) t -= 1;
				if (t < 1/6) return p + (q - p) * 6 * t;
				if (t < 1/2) return q;
				if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
				return p;
			};
			const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			const p = 2 * l - q;
			r = hue2rgb(p, q, h + 1/3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1/3);
		}
		return [r * 255, g * 255, b * 255];
	};

	// WebGL Shader Sources
	const vertexShaderSource = `
		attribute vec2 a_position;
		varying vec2 v_uv;
		void main() {
			v_uv = a_position * 0.5 + 0.5;
			gl_Position = vec4(a_position, 0.0, 1.0);
		}
	`;

	const updateStateShaderSource = `
		precision mediump float;
		uniform sampler2D u_currentStateTexture;
		uniform float u_deltaTime;
		uniform float u_time;
		varying vec2 v_uv;

		float random(vec2 st) {
			return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
		}

		void main() {
			vec4 currentState = texture2D(u_currentStateTexture, v_uv);
			float sourceIdx_norm = currentState.r;
			float targetIdx_norm = currentState.g;
			float progress = currentState.b;
			float speed = currentState.a * 10.0;

			progress += speed * u_deltaTime;

			if (progress >= 1.0) {
				progress = fract(progress);
				sourceIdx_norm = targetIdx_norm;
				vec2 seed = v_uv + vec2(u_time, progress);
				float newTargetIdx = floor(random(seed) * 40.0);
				targetIdx_norm = newTargetIdx / 39.0;
				// Much slower cell transitions: 0.08-0.20 range (was 0.15-0.35)
				speed = (random(seed + vec2(1.0)) * 0.12 + 0.08) * 0.48;
			}

			gl_FragColor = vec4(sourceIdx_norm, targetIdx_norm, progress, speed / 10.0);
		}
	`;

	const fragmentShaderSource = `
		precision mediump float;
		uniform sampler2D u_paletteTexture;
		uniform sampler2D u_cellStateTexture;
		uniform float u_songPaletteTransitionProgress;
		uniform float u_scrollOffset;
		varying vec2 v_uv;

		vec4 getColorFromMasterPalette(int index, float y_offset) {
			float texY_row = floor(float(index) / 8.0);
			float texX_col = mod(float(index), 8.0);
			float u = (texX_col + 0.5) / 8.0;
			float v = (texY_row + y_offset + 0.5) / 10.0;
			return texture2D(u_paletteTexture, vec2(u, v));
		}

		vec4 getCellColor(vec2 uv) {
			vec4 cellState = texture2D(u_cellStateTexture, uv);
			int sourceColorIndex = int(cellState.r * 39.0 + 0.5);
			int targetColorIndex = int(cellState.g * 39.0 + 0.5);
			float fadeProgress = cellState.b;

			vec4 prevPalette_source = getColorFromMasterPalette(sourceColorIndex, 0.0);
			vec4 targetPalette_source = getColorFromMasterPalette(sourceColorIndex, 5.0);
			vec4 colorA = mix(prevPalette_source, targetPalette_source, u_songPaletteTransitionProgress);

			vec4 prevPalette_target = getColorFromMasterPalette(targetColorIndex, 0.0);
			vec4 targetPalette_target = getColorFromMasterPalette(targetColorIndex, 5.0);
			vec4 colorB = mix(prevPalette_target, targetPalette_target, u_songPaletteTransitionProgress);

			return mix(colorA, colorB, fadeProgress);
		}

		void main() {
			float scrolledX = v_uv.x - u_scrollOffset;
			float cellX = scrolledX * 8.0;
			float cellXFrac = fract(cellX);

			vec4 color1 = getCellColor(vec2(fract(scrolledX), v_uv.y));
			vec4 color2 = getCellColor(vec2(fract(scrolledX + 1.0/8.0), v_uv.y));
			vec4 finalColor = mix(color1, color2, cellXFrac);
			
			// Very aggressively tone down brightness for better contrast
			float luminance = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
			if (luminance > 0.25) {
				// Reduce by up to 70% for very bright colors
				float reduction = (luminance - 0.25) * 0.93;
				finalColor.rgb *= (1.0 - reduction);
			}
			
			gl_FragColor = finalColor;
		}
	`;

	const blurFragmentShaderSource = `
		precision mediump float;
		uniform sampler2D u_image;
		uniform vec2 u_resolution;
		uniform vec2 u_direction;
		varying vec2 v_uv;

		void main() {
			vec2 texelSize = 1.0 / u_resolution;
			vec3 result = texture2D(u_image, v_uv).rgb * 0.227027;

			result += texture2D(u_image, v_uv + texelSize * u_direction * 1.0).rgb * 0.1945946;
			result += texture2D(u_image, v_uv - texelSize * u_direction * 1.0).rgb * 0.1945946;
			result += texture2D(u_image, v_uv + texelSize * u_direction * 2.0).rgb * 0.1216216;
			result += texture2D(u_image, v_uv - texelSize * u_direction * 2.0).rgb * 0.1216216;
			result += texture2D(u_image, v_uv + texelSize * u_direction * 3.0).rgb * 0.05405405;
			result += texture2D(u_image, v_uv - texelSize * u_direction * 3.0).rgb * 0.05405405;
			result += texture2D(u_image, v_uv + texelSize * u_direction * 4.0).rgb * 0.01621621;
			result += texture2D(u_image, v_uv - texelSize * u_direction * 4.0).rgb * 0.01621621;

			gl_FragColor = vec4(result, 1.0);
		}
	`;

	const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	};

	const createProgram = (gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null => {
		const program = gl.createProgram();
		if (!program) return null;
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error('Program linking error:', gl.getProgramInfoLog(program));
			gl.deleteProgram(program);
			return null;
		}
		return program;
	};

	const setupQuadBuffer = (gl: WebGLRenderingContext) => {
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
		return buffer;
	};

	const createTexture = (gl: WebGLRenderingContext, width: number, height: number): WebGLTexture | null => {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	};

	const createFramebuffer = (gl: WebGLRenderingContext, texture: WebGLTexture | null): WebGLFramebuffer | null => {
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		return framebuffer;
	};

	const initializeCellStates = (gl: WebGLRenderingContext) => {
		const data = new Uint8Array(DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT * 4);
		for (let i = 0; i < DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT; i++) {
			const idx = i * 4;
			data[idx] = Math.floor(Math.random() * 40) * (255 / 39); // source color
			data[idx + 1] = Math.floor(Math.random() * 40) * (255 / 39); // target color
			data[idx + 2] = Math.floor(Math.random() * 255); // progress
			// Much slower initial speed: 0.08-0.20 range (was 0.15-0.35)
			data[idx + 3] = Math.floor((Math.random() * 0.12 + 0.08) * 0.48 * 10 * 255 / 10); // speed
		}
		gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	};

	const initWebGL = () => {
		if (!browser || !webglCanvas) return false;

		const context = webglCanvas.getContext('webgl', {
			alpha: true,
			premultipliedAlpha: false,
			antialias: false,
			preserveDrawingBuffer: false
		});

		if (!context) {
			console.warn('WebGL not supported');
			return false;
		}

		gl = context;

		// Set canvas size
		webglCanvas.width = CANVAS_SIZE;
		webglCanvas.height = CANVAS_SIZE;

		// Create shaders and programs
		const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
		if (!vertexShader) return false;

		// Update state program
		const updateStateFragShader = createShader(gl, gl.FRAGMENT_SHADER, updateStateShaderSource);
		if (!updateStateFragShader) return false;
		updateStateProgram = createProgram(gl, vertexShader, updateStateFragShader);
		if (!updateStateProgram) return false;

		// Main render program
		const fragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
		if (!fragShader) return false;
		glProgram = createProgram(gl, vertexShader, fragShader);
		if (!glProgram) return false;

		// Blur program
		const blurFragShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);
		if (!blurFragShader) return false;
		blurProgram = createProgram(gl, vertexShader, blurFragShader);
		if (!blurProgram) return false;

		// Setup quad buffer
		setupQuadBuffer(gl);

		// Create textures and framebuffers
		cellStateTexture = createTexture(gl, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT);
		cellStateFramebuffer = createFramebuffer(gl, cellStateTexture);
		
		paletteTexture = createTexture(gl, MASTER_PALETTE_TEX_WIDTH, MASTER_PALETTE_TEX_HEIGHT * 2);
		
		colorRenderTexture = createTexture(gl, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
		colorRenderFramebuffer = createFramebuffer(gl, colorRenderTexture);
		
		const blurWidth = Math.round(CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);
		const blurHeight = Math.round(CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);
		blurTexture1 = createTexture(gl, blurWidth, blurHeight);
		blurFramebuffer1 = createFramebuffer(gl, blurTexture1);
		blurTexture2 = createTexture(gl, blurWidth, blurHeight);
		blurFramebuffer2 = createFramebuffer(gl, blurTexture2);

		// Initialize cell states with random values
		initializeCellStates(gl);

		// Setup context loss handlers
		if (!webglListenersAttached) {
			webglCanvas.addEventListener('webglcontextlost', (event) => {
				event.preventDefault();
				if (globalAnimationId !== null) {
					cancelAnimationFrame(globalAnimationId);
					globalAnimationId = null;
				}
				gl = null;
				glProgram = null;
				updateStateProgram = null;
				blurProgram = null;
			});

			webglCanvas.addEventListener('webglcontextrestored', () => {
				initWebGL();
				if (currentTargetMasterPalette.length > 0) {
					updatePaletteTexture(previousMasterPalette, currentTargetMasterPalette);
				}
			});
			
			webglListenersAttached = true;
		}

		return true;
	};

	const updatePaletteTexture = (previous: RGBColor[], target: RGBColor[]) => {
		if (!gl || !paletteTexture) return;

		const data = new Uint8Array(MASTER_PALETTE_TEX_WIDTH * MASTER_PALETTE_TEX_HEIGHT * 2 * 4);
		
		// Write previous palette to top 5 rows
		for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
			const color = previous[i] || { red: 0, green: 0, blue: 0 };
			const idx = i * 4;
			data[idx] = color.red;
			data[idx + 1] = color.green;
			data[idx + 2] = color.blue;
			data[idx + 3] = 255;
		}

		// Write target palette to bottom 5 rows
		const offset = MASTER_PALETTE_SIZE * 4;
		for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
			const color = target[i] || { red: 0, green: 0, blue: 0 };
			const idx = offset + i * 4;
			data[idx] = color.red;
			data[idx + 1] = color.green;
			data[idx + 2] = color.blue;
			data[idx + 3] = 255;
		}

		gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASTER_PALETTE_TEX_WIDTH, MASTER_PALETTE_TEX_HEIGHT * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	};

	const animateWebGLBackground = (timestamp: number) => {
		if (!gl || !glProgram || !updateStateProgram || !blurProgram) return;

		const deltaTime = lastFrameTime > 0 ? (timestamp - lastFrameTime) / 1000 : 0.016;
		lastFrameTime = timestamp;

		// Update scroll offset
		scrollOffset += SCROLL_SPEED * deltaTime;
		if (scrollOffset >= 1.0) scrollOffset -= 1.0;

		// Update palette transition
		if (songPaletteTransitionProgress < 1.0) {
			songPaletteTransitionProgress = Math.min(1.0, songPaletteTransitionProgress + SONG_PALETTE_TRANSITION_SPEED);
		}

		// Pass 1: Update cell states (lightweight mode skips this when not transitioning)
		if (performanceLevel !== 'low' || songPaletteTransitionProgress < 1.0) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, cellStateFramebuffer);
			gl.viewport(0, 0, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT);
			gl.useProgram(updateStateProgram);

			const positionLocation = gl.getAttribLocation(updateStateProgram, 'a_position');
			gl.enableVertexAttribArray(positionLocation);
			gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
			gl.uniform1i(gl.getUniformLocation(updateStateProgram, 'u_currentStateTexture'), 0);
			gl.uniform1f(gl.getUniformLocation(updateStateProgram, 'u_deltaTime'), deltaTime);
			gl.uniform1f(gl.getUniformLocation(updateStateProgram, 'u_time'), timestamp / 1000);

			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			// Copy result back to cellStateTexture
			gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
			gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT, 0);
		}

		// Pass 2: Render colors
		gl.bindFramebuffer(gl.FRAMEBUFFER, colorRenderFramebuffer);
		gl.viewport(0, 0, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
		gl.useProgram(glProgram);

		const positionLocation2 = gl.getAttribLocation(glProgram, 'a_position');
		gl.enableVertexAttribArray(positionLocation2);
		gl.vertexAttribPointer(positionLocation2, 2, gl.FLOAT, false, 0, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
		gl.uniform1i(gl.getUniformLocation(glProgram, 'u_paletteTexture'), 0);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
		gl.uniform1i(gl.getUniformLocation(glProgram, 'u_cellStateTexture'), 1);

		gl.uniform1f(gl.getUniformLocation(glProgram, 'u_songPaletteTransitionProgress'), songPaletteTransitionProgress);
		gl.uniform1f(gl.getUniformLocation(glProgram, 'u_scrollOffset'), scrollOffset);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		// Pass 3: Horizontal blur
		const blurWidth = Math.round(CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);
		const blurHeight = Math.round(CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);

		gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer1);
		gl.viewport(0, 0, blurWidth, blurHeight);
		gl.useProgram(blurProgram);

		const positionLocation3 = gl.getAttribLocation(blurProgram, 'a_position');
		gl.enableVertexAttribArray(positionLocation3);
		gl.vertexAttribPointer(positionLocation3, 2, gl.FLOAT, false, 0, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, colorRenderTexture);
		gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_image'), 0);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), 1.0, 0.0);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		// Pass 4: Vertical blur & display
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, CANVAS_SIZE, CANVAS_SIZE);
		gl.useProgram(blurProgram);

		gl.enableVertexAttribArray(positionLocation3);
		gl.vertexAttribPointer(positionLocation3, 2, gl.FLOAT, false, 0, 0);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, blurTexture1);
		gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_image'), 0);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), blurWidth, blurHeight);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), 0.0, 1.0);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		// Continue animation if needed
		if (canvasVisible && backgroundEnabled && (performanceLevel !== 'low' || songPaletteTransitionProgress < 1.0)) {
			globalAnimationId = requestAnimationFrame(animateWebGLBackground);
		} else {
			globalAnimationId = null;
		}
	};

	const startAnimation = () => {
		if (globalAnimationId === null && gl) {
			lastFrameTime = 0;
			globalAnimationId = requestAnimationFrame(animateWebGLBackground);
		}
	};

	const stopAnimation = () => {
		if (globalAnimationId !== null) {
			cancelAnimationFrame(globalAnimationId);
			globalAnimationId = null;
		}
	};

	const resolveArtworkUrl = (track: PlayerStateShape['currentTrack']): string | null => {
		if (!track) return null;

		if (track.thumbnailUrl) {
			return track.thumbnailUrl;
		}

		const albumCover = track.album?.cover ?? null;
		if (albumCover) {
			const imageSize = performanceLevel === 'low' ? '320' : performanceLevel === 'medium' ? '640' : '1280';
			return losslessAPI.getCoverUrl(albumCover, imageSize);
		}

		const artistPicture = track.artist?.picture ?? track.artists?.find((artist) => Boolean(artist?.picture))?.picture ?? null;
		if (artistPicture) {
			return losslessAPI.getArtistPictureUrl(artistPicture, '750');
		}

		return null;
	};

	const updateFromTrack = async (state: PlayerStateShape | null = null) => {
		if (performanceLevel === 'low') {
			currentCoverUrl = null;
			retryAttempts = 0;
			return;
		}

		const snapshot = state ?? latestState;
		const token = ++requestToken;

		if (!snapshot?.currentTrack) {
			currentCoverUrl = null;
			retryAttempts = 0;
			return;
		}

		const coverUrl = resolveArtworkUrl(snapshot.currentTrack);

		if (!coverUrl) {
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
			const { palette, mostVibrant } = await extractPaletteFromImageWebGL(coverUrl);
			if (token === requestToken && palette.length === MASTER_PALETTE_SIZE) {
				// Update palette for WebGL
				previousMasterPalette = [...currentTargetMasterPalette];
				currentTargetMasterPalette = palette;
				songPaletteTransitionProgress = 0.0;
				
				updatePaletteTexture(previousMasterPalette, currentTargetMasterPalette);
				
				// Update CSS variable for lyrics color
				if (mostVibrant) {
					setCssVariables(mostVibrant);
				}
				
				// Start animation
				startAnimation();
			}
		} catch (error) {
			console.warn('Failed to extract palette from cover art', error);
			if (token === requestToken) {
				currentCoverUrl = null;
				retryAttempts += 1;
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
		
		const coverUrl = state.currentTrack ? resolveArtworkUrl(state.currentTrack) : null;
		
		if (backgroundEnabled && coverUrl === lastProcessedCover) {
			return;
		}

		lastProcessedCover = backgroundEnabled ? coverUrl : null;
		updateFromTrack(state);
	};

	type PlayerStateShape = {
		currentTrack: {
			thumbnailUrl?: string | null;
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
						thumbnailUrl: 'thumbnailUrl' in $state.currentTrack ? $state.currentTrack.thumbnailUrl : null,
						album: 'album' in $state.currentTrack ? {
							cover: $state.currentTrack.album?.cover ?? null,
							videoCover: $state.currentTrack.album?.videoCover ?? null
						} : undefined,
						artist: 'artist' in $state.currentTrack && $state.currentTrack.artist
							? {
								picture: $state.currentTrack.artist.picture ?? null
							}
							: null,
						artists: 'artists' in $state.currentTrack ? $state.currentTrack.artists?.map((artist) => ({
							picture: artist.picture ?? null
						})) ?? null : null
					}
					: null,
				isPlaying: $state.isPlaying
			};
			handlePlayerChange(snapshot);
		});
	};

	onMount(() => {
		if (!browser) return;
		
		// Initialize WebGL only if not in low performance mode
		if (performanceLevel !== 'low') {
			if (!initWebGL()) {
				console.warn('Failed to initialize WebGL');
				backgroundEnabled = false;
				// Don't return here, continue setup
			}
		}
		
		// Setup intersection observer for visibility
		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				canvasVisible = entry.isIntersecting;
				if (entry.isIntersecting && backgroundEnabled) {
					startAnimation();
				} else {
					stopAnimation();
				}
			});
		}, { threshold: 0.01 });
		
		if (webglCanvas) {
			observer.observe(webglCanvas);
		}
		
		// Subscribe to performance settings
		const unsubPerf = effectivePerformanceLevel.subscribe((level) => {
			const previousLevel = performanceLevel;
			if (level === previousLevel) {
				return;
			}

			performanceLevel = level;
			backgroundEnabled = level !== 'low';

			if (level === 'low') {
				requestToken += 1;
				lastProcessedCover = null;
				currentCoverUrl = null;
				retryAttempts = 0;
				stopAnimation();
				
				// Release WebGL context to free resources
				if (gl) {
					gl.getExtension('WEBGL_lose_context')?.loseContext();
				}
			} else if (previousLevel === 'low') {
				// Re-initialize WebGL if needed
				if (!gl) {
					initWebGL();
				}
				
				if (latestState?.currentTrack) {
					lastProcessedCover = null;
					currentCoverUrl = null;
					retryAttempts = 0;
					updateFromTrack(latestState);
				}
			}
		});
		
		const unsubAnim = animationsEnabled.subscribe((enabled) => {
			enableAnimations = enabled;
		});
		
		// Get current state before subscribing
		const currentState = get(playerStore);
		if (currentState.currentTrack) {
			const snapshot: PlayerStateShape = {
				currentTrack: {
					thumbnailUrl: 'thumbnailUrl' in currentState.currentTrack ? currentState.currentTrack.thumbnailUrl : null,
					album: 'album' in currentState.currentTrack ? {
						cover: currentState.currentTrack.album?.cover ?? null,
						videoCover: currentState.currentTrack.album?.videoCover ?? null
					} : undefined,
					artist: 'artist' in currentState.currentTrack && currentState.currentTrack.artist
						? {
							picture: currentState.currentTrack.artist.picture ?? null
						}
						: null,
					artists: 'artists' in currentState.currentTrack ? currentState.currentTrack.artists?.map((artist) => ({
						picture: artist.picture ?? null
					})) ?? null : null
				},
				isPlaying: currentState.isPlaying
			};
			
			const coverUrl = resolveArtworkUrl(snapshot.currentTrack);
			backgroundEnabled = performanceLevel !== 'low';
			lastProcessedCover = backgroundEnabled ? coverUrl : null;
			latestState = snapshot;
			isPlaying = snapshot.isPlaying && Boolean(snapshot.currentTrack);
			updateFromTrack(snapshot);
		}
		
		// Subscribe after handling initial state
		subscribeToPlayer();
		
		return () => {
			unsubPerf();
			unsubAnim();
			observer.disconnect();
			stopAnimation();
		};
	});

	onDestroy(() => {
		unsubscribe?.();
		stopAnimation();
	});
</script>

<div class="webgl-background" aria-hidden="true" data-performance={performanceLevel}>
	{#if (!currentTargetMasterPalette.length && !isPlaying) || performanceLevel === 'low'}
		<div class="default-background"></div>
	{/if}
	<canvas
		bind:this={webglCanvas}
		class="webgl-background__canvas"
		style="width: 100%; height: 100%; opacity: {currentTargetMasterPalette.length && isPlaying ? 1 : 0};"
	></canvas>
</div>

<style>
	.webgl-background {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
		background: #0a0e1a;
	}

	.default-background {
		position: absolute;
		inset: 0;
		background: 
			radial-gradient(ellipse at 20% 30%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
			radial-gradient(ellipse at 80% 70%, rgba(99, 102, 241, 0.12) 0%, transparent 50%),
			radial-gradient(ellipse at 50% 50%, rgba(139, 92, 246, 0.08) 0%, transparent 60%),
			linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #1e293b 100%);
		animation: ambient-float 20s ease-in-out infinite;
	}

	@keyframes ambient-float {
		0%, 100% {
			transform: scale(1) rotate(0deg);
			opacity: 1;
		}
		33% {
			transform: scale(1.05) rotate(1deg);
			opacity: 0.95;
		}
		66% {
			transform: scale(0.98) rotate(-1deg);
			opacity: 0.98;
		}
	}

	.webgl-background__canvas {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: opacity 1.2s ease-in-out;
	}
</style>
