/**
 * WebGL shader programs for dynamic background rendering
 */

// Vertex shader (shared by all passes)
export const vertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_uv;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = a_texCoord;
}
`;

// Pass 1: Cell State Update (GPGPU)
// Updates animation state for each of the 40 cells
export const updateStateShaderSource = `
precision highp float;

uniform sampler2D u_currentStateTexture;
uniform float u_deltaTime;
uniform float u_time;
varying vec2 v_uv;

// Simple pseudo-random function
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec4 currentState = texture2D(u_currentStateTexture, v_uv);
    float sourceIdx_norm = currentState.r;
    float targetIdx_norm = currentState.g;
    float progress = currentState.b;
    float speed = currentState.a * 10.0;
    
    // Advance transition progress
    progress += speed * u_deltaTime;
    
    if (progress >= 1.0) {
        // Transition complete - pick new target color
        progress = fract(progress);
        sourceIdx_norm = targetIdx_norm;
        
        // Generate new random target index (0-39 mapped to 0.0-1.0)
        vec2 seed = v_uv + vec2(u_time * 0.001, progress);
        float newTargetIdx = floor(random(seed) * 40.0);
        targetIdx_norm = newTargetIdx / 39.0;
        
        // Generate new random speed
        seed = v_uv + vec2(u_time * 0.002, progress * 2.0);
        speed = (random(seed) * 0.5 + 0.5) * 0.48;
    }
    
    gl_FragColor = vec4(sourceIdx_norm, targetIdx_norm, progress, speed / 10.0);
}
`;

// Pass 2: Color Rendering
// Renders the 8x5 grid with smooth color transitions
export const colorRenderShaderSource = `
precision highp float;

uniform sampler2D u_paletteTexture;
uniform sampler2D u_cellStateTexture;
uniform float u_songPaletteTransitionProgress;
uniform float u_scrollOffset;
varying vec2 v_uv;

// Get color from master palette (8x10 texture)
// y_offset = 0.0 for previous palette, 5.0 for target palette
vec4 getColorFromMasterPalette(int index, float y_offset) {
    float texY_row = floor(float(index) / 8.0);
    float texX_col = mod(float(index), 8.0);
    float u = (texX_col + 0.5) / 8.0;
    float v = (texY_row + y_offset + 0.5) / 10.0;
    return texture2D(u_paletteTexture, vec2(u, v));
}

// Get interpolated color for a cell
vec4 getCellColor(vec2 uv) {
    vec4 cellState = texture2D(u_cellStateTexture, uv);
    int sourceColorIndex = int(cellState.r * 39.0 + 0.5);
    int targetColorIndex = int(cellState.g * 39.0 + 0.5);
    float fadeProgress = cellState.b;
    
    // Get colors from both palette layers
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
    
    // Wrap around for seamless horizontal scrolling
    scrolledX = fract(scrolledX);
    
    float cellX = scrolledX * 8.0;
    float cellXFrac = fract(cellX);
    
    // Sample adjacent cells and interpolate for smoothness
    vec2 cell1UV = vec2(scrolledX, v_uv.y);
    vec2 cell2UV = vec2(fract(scrolledX + 1.0/8.0), v_uv.y);
    
    vec4 color1 = getCellColor(cell1UV);
    vec4 color2 = getCellColor(cell2UV);
    
    gl_FragColor = mix(color1, color2, cellXFrac);
}
`;

// Pass 3 & 4: Gaussian Blur
// Separable 9-tap Gaussian blur (horizontal and vertical)
export const blurFragmentShaderSource = `
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_direction;
varying vec2 v_uv;

void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec3 result = texture2D(u_image, v_uv).rgb * 0.227027;
    
    // 9-tap Gaussian kernel
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

/**
 * Create and compile a shader
 */
export function createShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string
): WebGLShader | null {
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
}

/**
 * Create and link a shader program
 */
export function createProgram(
	gl: WebGLRenderingContext,
	vertexShader: WebGLShader,
	fragmentShader: WebGLShader
): WebGLProgram | null {
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
}

/**
 * Set up a full-screen quad (two triangles)
 */
export function setupQuad(gl: WebGLRenderingContext): void {
	const positions = new Float32Array([
		-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0
	]);

	const texCoords = new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]);

	const positionBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

	const texCoordBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
}

/**
 * Create a texture
 */
export function createTexture(
	gl: WebGLRenderingContext,
	width: number,
	height: number,
	data: Uint8Array | null = null
): WebGLTexture | null {
	const texture = gl.createTexture();
	if (!texture) return null;

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		width,
		height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		data
	);

	// Use nearest neighbor filtering for palette and state textures
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	return texture;
}

/**
 * Create a framebuffer with attached texture
 */
export function createFramebuffer(
	gl: WebGLRenderingContext,
	texture: WebGLTexture
): WebGLFramebuffer | null {
	const framebuffer = gl.createFramebuffer();
	if (!framebuffer) return null;

	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		console.error('Framebuffer incomplete:', status);
		gl.deleteFramebuffer(framebuffer);
		return null;
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	return framebuffer;
}
