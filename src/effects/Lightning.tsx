import { useEffect, useRef } from "react";
import { hexToHue, hexToVividness } from "./color";

// Lightning shader background (ported from the NoRisk launcher / ReactBits "Lightning").
// Raw WebGL, no extra dependency. Pauses while the window is hidden.
// Each effect run creates its own canvas: releasing the GL context on cleanup would otherwise
// leave a dead context behind for the next run (React StrictMode mounts effects twice).

type Props = {
  /** Any hex color: its hue and how colorful it is (grey gives a white bolt) */
  color: string;
  speed?: number;
  intensity?: number;
  size?: number;
  opacity?: number;
};

const OCTAVES = 10;

const VERTEX = `
  attribute vec2 aPosition;
  void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const FRAGMENT = `
  precision mediump float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uHue;
  uniform float uSat;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uSize;
  #define OCTAVE_COUNT ${OCTAVES}

  vec3 hsv2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z * mix(vec3(1.0), rgb, c.y);
  }
  float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  mat2 rotate2d(float t) { float c = cos(t); float s = sin(t); return mat2(c, -s, s, c); }
  float noise(vec2 p) {
    vec2 ip = floor(p); vec2 fp = fract(p);
    float a = hash12(ip); float b = hash12(ip + vec2(1.0, 0.0));
    float c = hash12(ip + vec2(0.0, 1.0)); float d = hash12(ip + vec2(1.0, 1.0));
    vec2 t = smoothstep(0.0, 1.0, fp);
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  }
  float fbm(vec2 p) {
    float value = 0.0; float amplitude = 0.5;
    for (int i = 0; i < OCTAVE_COUNT; ++i) { value += amplitude * noise(p); p *= rotate2d(0.45); p *= 2.0; amplitude *= 0.5; }
    return value;
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = 2.0 * uv - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    uv += 2.0 * fbm(uv * uSize + 0.8 * iTime * uSpeed) - 1.0;
    float dist = abs(uv.x);
    vec3 baseColor = hsv2rgb(vec3(uHue / 360.0, 0.7 * uSat, 0.8));
    vec3 col = baseColor * (mix(0.0, 0.07, hash11(iTime * uSpeed)) / dist) * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Lightning shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function Lightning({ color, speed = 0.8, intensity = 1.2, size = 1.5, opacity = 0.7 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hue = hexToHue(color);
  const sat = hexToVividness(color);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = document.createElement("canvas");
    canvas.className = "effect-canvas";
    container.appendChild(canvas);
    const gl = canvas.getContext("webgl");
    if (!gl) {
      canvas.remove();
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      canvas.remove();
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const u = {
      resolution: gl.getUniformLocation(program, "iResolution"),
      time: gl.getUniformLocation(program, "iTime"),
      hue: gl.getUniformLocation(program, "uHue"),
      sat: gl.getUniformLocation(program, "uSat"),
      speed: gl.getUniformLocation(program, "uSpeed"),
      intensity: gl.getUniformLocation(program, "uIntensity"),
      size: gl.getUniformLocation(program, "uSize"),
    };
    gl.uniform1f(u.hue, hue);
    gl.uniform1f(u.sat, sat);
    gl.uniform1f(u.speed, speed);
    gl.uniform1f(u.intensity, intensity);
    gl.uniform1f(u.size, size);

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      if (document.hidden) return;
      gl.uniform1f(u.time, (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [hue, sat, speed, intensity, size]);

  return <div ref={containerRef} className="effect-layer" style={{ opacity }} />;
}

export default Lightning;
