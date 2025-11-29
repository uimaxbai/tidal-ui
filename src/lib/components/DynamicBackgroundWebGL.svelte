<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { playerStore } from '$lib/stores/player';
	import { effectivePerformanceLevel } from '$lib/stores/performance';
	import { losslessAPI } from '$lib/api';
	import {
		extractPaletteFromImage,
		getMostVibrantColor,
		type Color
	} from '$lib/utils/colorExtraction';
	import {
		vertexShaderSource,
		updateStateShaderSource,
		colorRenderShaderSource,
		blurFragmentShaderSource,
		createShader,
		createProgram,
		setupQuad,
		createTexture,
		createFramebuffer
	} from '$lib/utils/webglShaders';

	// Constants
	const DISPLAY_CANVAS_SIZE = 512;
	const MASTER_PALETTE_SIZE = 40;
	const DISPLAY_GRID_WIDTH = 8;
	const DISPLAY_GRID_HEIGHT = 5;
	const STRETCHED_GRID_WIDTH = 32;
	const STRETCHED_GRID_HEIGHT = 18;
	const BLUR_DOWNSAMPLE_FACTOR = 26;
	const SONG_PALETTE_TRANSITION_SPEED = 0.015;
	const SCROLL_SPEED = 0.008;

	// Canvas and WebGL context
	let canvasElement: HTMLCanvasElement;
	let gl: WebGLRenderingContext | null = null;

	// Shader programs
	let updateStateProgram: WebGLProgram | null = null;
	let colorRenderProgram: WebGLProgram | null = null;
	let blurProgram: WebGLProgram | null = null;

	// Textures and framebuffers
	let paletteTexture: WebGLTexture | null = null;
	let cellStateTexture: WebGLTexture | null = null;
	let cellStateTexture2: WebGLTexture | null = null;
	let colorRenderTexture: WebGLTexture | null = null;
	let blurTexture1: WebGLTexture | null = null;
	let blurTexture2: WebGLTexture | null = null;

	let stateFramebuffer1: WebGLFramebuffer | null = null;
	let stateFramebuffer2: WebGLFramebuffer | null = null;
	let colorRenderFramebuffer: WebGLFramebuffer | null = null;
	let blurFramebuffer1: WebGLFramebuffer | null = null;
	let blurFramebuffer2: WebGLFramebuffer | null = null;

	// Animation state
	let previousPalette: Color[] = [];
	let targetPalette: Color[] = [];
	let songPaletteTransitionProgress = 1.0;
	let scrollOffset = 0.0;
	let lastFrameTime = performance.now();
	let animationFrameId: number | null = null;
	let currentStateTexture = 0; // 0 or 1 for ping-pong

	// Performance flags
	let isLightweight = false;
	let isVisible = true;

	// Track current song
	let currentTrackId: number | string | null = null;

	onMount(() => {
		initializeWebGL();
		setupIntersectionObserver();

		// Subscribe to performance level changes
		const unsubscribePerf = effectivePerformanceLevel.subscribe((level) => {
			isLightweight = level === 'low';
		});

		// Subscribe to player changes
		const unsubscribePlayer = playerStore.subscribe(async (state) => {
			if (state.currentTrack && state.currentTrack.id !== currentTrackId) {
				currentTrackId = state.currentTrack.id;
				let coverUrl = '';
				if ('thumbnailUrl' in state.currentTrack && state.currentTrack.thumbnailUrl) {
					coverUrl = state.currentTrack.thumbnailUrl;
				} else if ('album' in state.currentTrack && state.currentTrack.album?.cover) {
					coverUrl = state.currentTrack.album.cover;
				}

				if (coverUrl) {
					await updateFromTrack(coverUrl);
				}
			}
		});

		return () => {
			unsubscribePerf();
			unsubscribePlayer();
		};
	});

	onDestroy(() => {
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
		}
		cleanupWebGL();
	});

	function initializeWebGL() {
		if (!canvasElement) return;

		// Set canvas size
		canvasElement.width = DISPLAY_CANVAS_SIZE;
		canvasElement.height = DISPLAY_CANVAS_SIZE;

		// Get WebGL context
		gl = canvasElement.getContext('webgl', {
			alpha: false,
			antialias: false,
			depth: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false
		});

		if (!gl) {
			console.error('WebGL not supported');
			return;
		}

		// Handle context loss
		canvasElement.addEventListener('webglcontextlost', handleContextLost, false);
		canvasElement.addEventListener('webglcontextrestored', handleContextRestored, false);

		setupShaders();
		setupTextures();
		setupFramebuffers();
		initializeCellStates();
		startAnimation();
	}

	function setupShaders() {
		if (!gl) return;

		// Create vertex shader
		const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
		if (!vertexShader) return;

		// Create update state program
		const updateStateFragShader = createShader(gl, gl.FRAGMENT_SHADER, updateStateShaderSource);
		if (updateStateFragShader) {
			updateStateProgram = createProgram(gl, vertexShader, updateStateFragShader);
		}

		// Create color render program
		const colorRenderFragShader = createShader(gl, gl.FRAGMENT_SHADER, colorRenderShaderSource);
		if (colorRenderFragShader) {
			colorRenderProgram = createProgram(gl, vertexShader, colorRenderFragShader);
		}

		// Create blur program
		const blurFragShader = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource);
		if (blurFragShader) {
			blurProgram = createProgram(gl, vertexShader, blurFragShader);
		}

		setupQuad(gl);
	}

	function setupTextures() {
		if (!gl) return;

		const blurWidth = Math.round(DISPLAY_CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);
		const blurHeight = Math.round(DISPLAY_CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);

		// Palette texture (8x10 - double-buffered palette)
		paletteTexture = createTexture(gl, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT * 2);

		// Cell state textures (8x5 - ping-pong for state updates)
		cellStateTexture = createTexture(gl, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT);
		cellStateTexture2 = createTexture(gl, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT);

		// Color render texture (32x18)
		colorRenderTexture = createTexture(gl, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);

		// Blur textures
		blurTexture1 = createTexture(gl, blurWidth, blurHeight);
		blurTexture2 = createTexture(gl, blurWidth, blurHeight);
	}

	function setupFramebuffers() {
		if (!gl || !cellStateTexture || !cellStateTexture2 || !colorRenderTexture || !blurTexture1 || !blurTexture2) return;

		stateFramebuffer1 = createFramebuffer(gl, cellStateTexture);
		stateFramebuffer2 = createFramebuffer(gl, cellStateTexture2);
		colorRenderFramebuffer = createFramebuffer(gl, colorRenderTexture);
		blurFramebuffer1 = createFramebuffer(gl, blurTexture1);
		blurFramebuffer2 = createFramebuffer(gl, blurTexture2);
	}

	function initializeCellStates() {
		if (!gl || !cellStateTexture) return;

		// Initialize with random states
		const stateData = new Uint8Array(DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT * 4);

		for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
			const idx = i * 4;
			const sourceIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
			const targetIdx = Math.floor(Math.random() * MASTER_PALETTE_SIZE);
			const progress = Math.random();
			const speed = (Math.random() * 0.5 + 0.5) * 0.48;

			stateData[idx] = Math.round((sourceIdx / 39) * 255);
			stateData[idx + 1] = Math.round((targetIdx / 39) * 255);
			stateData[idx + 2] = Math.round(progress * 255);
			stateData[idx + 3] = Math.round((speed / 10.0) * 255);
		}

		gl.bindTexture(gl.TEXTURE_2D, cellStateTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			DISPLAY_GRID_WIDTH,
			DISPLAY_GRID_HEIGHT,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			stateData
		);
	}

	async function updateFromTrack(coverUrl: string) {
		try {
			const fullCoverUrl = coverUrl.startsWith('http') ? coverUrl : losslessAPI.getCoverUrl(coverUrl, '640');
			const palette = await extractPaletteFromImage(
				fullCoverUrl,
				DISPLAY_GRID_WIDTH,
				DISPLAY_GRID_HEIGHT,
				STRETCHED_GRID_WIDTH,
				STRETCHED_GRID_HEIGHT
			);

			// Shift current target to previous
			previousPalette = targetPalette.length > 0 ? targetPalette : palette;
			targetPalette = palette;

			// Update palette texture
			updatePaletteTexture();

			// Reset transition
			songPaletteTransitionProgress = 0.0;

			// Get vibrant color for lyrics (could be exposed via a store)
			const vibrantColor = getMostVibrantColor(palette);
			document.documentElement.style.setProperty(
				'--dynamic-bg-vibrant',
				`rgb(${vibrantColor.r}, ${vibrantColor.g}, ${vibrantColor.b})`
			);
		} catch (error) {
			console.error('Failed to update background from track:', error);
		}
	}

	function updatePaletteTexture() {
		if (!gl || !paletteTexture) return;

		const textureData = new Uint8Array(DISPLAY_GRID_WIDTH * DISPLAY_GRID_HEIGHT * 2 * 4);

		// Write previous palette to rows 0-4
		for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
			const color = previousPalette[i] || { r: 0, g: 0, b: 0, a: 255 };
			const idx = i * 4;
			textureData[idx] = color.r;
			textureData[idx + 1] = color.g;
			textureData[idx + 2] = color.b;
			textureData[idx + 3] = color.a;
		}

		// Write target palette to rows 5-9
		for (let i = 0; i < MASTER_PALETTE_SIZE; i++) {
			const color = targetPalette[i] || { r: 0, g: 0, b: 0, a: 255 };
			const idx = (MASTER_PALETTE_SIZE + i) * 4;
			textureData[idx] = color.r;
			textureData[idx + 1] = color.g;
			textureData[idx + 2] = color.b;
			textureData[idx + 3] = color.a;
		}

		gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			DISPLAY_GRID_WIDTH,
			DISPLAY_GRID_HEIGHT * 2,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			textureData
		);
	}

	function startAnimation() {
		if (animationFrameId !== null) return;
		lastFrameTime = performance.now();
		animationFrameId = requestAnimationFrame(animate);
	}

	function stopAnimation() {
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	function animate(currentTime: number) {
		if (!gl || !isVisible) {
			animationFrameId = requestAnimationFrame(animate);
			return;
		}

		const deltaTime = Math.min((currentTime - lastFrameTime) / 1000, 0.1); // Cap at 100ms
		lastFrameTime = currentTime;

		// Update animation state
		if (songPaletteTransitionProgress < 1.0) {
			songPaletteTransitionProgress = Math.min(1.0, songPaletteTransitionProgress + SONG_PALETTE_TRANSITION_SPEED);
		}

		scrollOffset += SCROLL_SPEED * deltaTime;
		if (scrollOffset >= 1.0) scrollOffset -= 1.0;

		// Render pipeline
		renderPipeline(deltaTime, currentTime);

		animationFrameId = requestAnimationFrame(animate);
	}

	function renderPipeline(deltaTime: number, currentTime: number) {
		if (!gl) return;

		// Pass 1: Update cell states (skip in lightweight mode unless transitioning)
		if (!isLightweight || songPaletteTransitionProgress < 1.0) {
			updateCellStates(deltaTime, currentTime);
		}

		// Pass 2: Render colors with current states
		renderColors();

		// Pass 3: Horizontal blur
		renderHorizontalBlur();

		// Pass 4: Vertical blur and display
		renderVerticalBlur();
	}

	function updateCellStates(deltaTime: number, currentTime: number) {
		if (!gl || !updateStateProgram || !stateFramebuffer1 || !stateFramebuffer2) return;

		gl.useProgram(updateStateProgram);

		// Bind source state texture
		const sourceTexture = currentStateTexture === 0 ? cellStateTexture : cellStateTexture2;
		const targetFramebuffer = currentStateTexture === 0 ? stateFramebuffer2 : stateFramebuffer1;

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
		gl.uniform1i(gl.getUniformLocation(updateStateProgram, 'u_currentStateTexture'), 0);
		gl.uniform1f(gl.getUniformLocation(updateStateProgram, 'u_deltaTime'), deltaTime);
		gl.uniform1f(gl.getUniformLocation(updateStateProgram, 'u_time'), currentTime);

		// Set up attributes
		setupAttributes(updateStateProgram);

		// Render to target framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
		gl.viewport(0, 0, DISPLAY_GRID_WIDTH, DISPLAY_GRID_HEIGHT);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		// Swap state textures
		currentStateTexture = 1 - currentStateTexture;
	}

	function renderColors() {
		if (!gl || !colorRenderProgram || !colorRenderFramebuffer) return;

		gl.useProgram(colorRenderProgram);

		// Bind palette texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
		gl.uniform1i(gl.getUniformLocation(colorRenderProgram, 'u_paletteTexture'), 0);

		// Bind cell state texture
		const currentTexture = currentStateTexture === 0 ? cellStateTexture : cellStateTexture2;
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, currentTexture);
		gl.uniform1i(gl.getUniformLocation(colorRenderProgram, 'u_cellStateTexture'), 1);

		// Set uniforms
		gl.uniform1f(
			gl.getUniformLocation(colorRenderProgram, 'u_songPaletteTransitionProgress'),
			songPaletteTransitionProgress
		);
		gl.uniform1f(gl.getUniformLocation(colorRenderProgram, 'u_scrollOffset'), scrollOffset);

		// Set up attributes
		setupAttributes(colorRenderProgram);

		// Render to color framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, colorRenderFramebuffer);
		gl.viewport(0, 0, STRETCHED_GRID_WIDTH, STRETCHED_GRID_HEIGHT);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	function renderHorizontalBlur() {
		if (!gl || !blurProgram || !blurFramebuffer1) return;

		gl.useProgram(blurProgram);

		// Bind color render texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, colorRenderTexture);
		gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_image'), 0);

		const blurWidth = Math.round(DISPLAY_CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);
		const blurHeight = Math.round(DISPLAY_CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);

		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), blurWidth, blurHeight);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), 1.0, 0.0); // Horizontal

		// Set up attributes
		setupAttributes(blurProgram);

		// Render to blur framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffer1);
		gl.viewport(0, 0, blurWidth, blurHeight);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	function renderVerticalBlur() {
		if (!gl || !blurProgram) return;

		gl.useProgram(blurProgram);

		// Bind horizontal blur result
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, blurTexture1);
		gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_image'), 0);

		const blurWidth = Math.round(DISPLAY_CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);
		const blurHeight = Math.round(DISPLAY_CANVAS_SIZE / BLUR_DOWNSAMPLE_FACTOR);

		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_resolution'), blurWidth, blurHeight);
		gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), 0.0, 1.0); // Vertical

		// Set up attributes
		setupAttributes(blurProgram);

		// Render to canvas
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, DISPLAY_CANVAS_SIZE, DISPLAY_CANVAS_SIZE);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	function setupAttributes(program: WebGLProgram) {
		if (!gl) return;

		const positionLocation = gl.getAttribLocation(program, 'a_position');
		const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');

		// Position attribute
		const positions = new Float32Array([
			-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0
		]);
		const positionBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(positionLocation);
		gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

		// TexCoord attribute
		const texCoords = new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]);
		const texCoordBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(texCoordLocation);
		gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
	}

	function setupIntersectionObserver() {
		if (!canvasElement || typeof IntersectionObserver === 'undefined') return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					isVisible = entry.isIntersecting;
					if (entry.isIntersecting) {
						startAnimation();
					} else {
						stopAnimation();
					}
				}
			},
			{ threshold: 0.01 }
		);

		observer.observe(canvasElement);
	}

	function handleContextLost(event: Event) {
		event.preventDefault();
		stopAnimation();
		console.warn('WebGL context lost');
	}

	function handleContextRestored() {
		console.log('WebGL context restored');
		initializeWebGL();
	}

	function cleanupWebGL() {
		if (!gl) return;

		// Delete textures
		if (paletteTexture) gl.deleteTexture(paletteTexture);
		if (cellStateTexture) gl.deleteTexture(cellStateTexture);
		if (cellStateTexture2) gl.deleteTexture(cellStateTexture2);
		if (colorRenderTexture) gl.deleteTexture(colorRenderTexture);
		if (blurTexture1) gl.deleteTexture(blurTexture1);
		if (blurTexture2) gl.deleteTexture(blurTexture2);

		// Delete framebuffers
		if (stateFramebuffer1) gl.deleteFramebuffer(stateFramebuffer1);
		if (stateFramebuffer2) gl.deleteFramebuffer(stateFramebuffer2);
		if (colorRenderFramebuffer) gl.deleteFramebuffer(colorRenderFramebuffer);
		if (blurFramebuffer1) gl.deleteFramebuffer(blurFramebuffer1);
		if (blurFramebuffer2) gl.deleteFramebuffer(blurFramebuffer2);

		// Delete programs
		if (updateStateProgram) gl.deleteProgram(updateStateProgram);
		if (colorRenderProgram) gl.deleteProgram(colorRenderProgram);
		if (blurProgram) gl.deleteProgram(blurProgram);
	}
</script>

<div class="dynamic-background-container">
	<canvas bind:this={canvasElement} class="dynamic-background-canvas"></canvas>
</div>

<style>
	.dynamic-background-container {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
	}

	.dynamic-background-canvas {
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: blur(0px);
	}
</style>
