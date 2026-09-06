"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A 360° room viewer: drag to look around, scroll or pinch to zoom.
 *
 * WHY THIS IS HAND-WRITTEN AND NOT A LIBRARY
 *
 * Every panorama package worth using pulls in a WebGL scene graph — three.js
 * and a viewer on top of it is the better part of 600KB before a single
 * photograph loads. This is a restaurant website whose visitors are mostly on
 * a phone deciding where to hold a birthday, and the whole job here is: map a
 * direction to a pixel in an equirectangular image. That is nine lines of
 * trigonometry in a fragment shader. The rest of a scene graph — meshes,
 * materials, a render loop over a scene tree — would be carried and never used.
 *
 * WHY THERE IS NO SPHERE
 *
 * The obvious construction is a sphere with the photograph on the inside and a
 * camera at the centre, which means generating and uploading a few thousand
 * vertices. But nothing else is in the scene, so the geometry cannot occlude
 * anything or be occluded, and it is only ever a way of turning a screen pixel
 * into a direction. Doing that directly is exact where a sphere is an
 * approximation that shows as wobble along the horizon at low tessellation:
 * two triangles covering the screen, and the shader computes the ray for each
 * pixel itself. Fewer moving parts and a better picture.
 *
 * WHAT AN EQUIRECTANGULAR IMAGE IS
 *
 * One frame, twice as wide as it is tall, holding the whole sphere: x is the
 * compass bearing from -180° to 180°, y is the angle from straight up to
 * straight down. It is the format every 360 camera and the Street View app
 * exports, and it looks like a smeared panorama until it is wrapped, which is
 * why `room_images.kind` keeps these out of the ordinary photo grid.
 *
 * THE PART THAT IS NOT OBVIOUS
 *
 * The photograph is resized to a power of two before it is uploaded. WebGL 1
 * refuses to repeat a texture whose dimensions are not powers of two, and
 * repeating horizontally is what makes the join behind the viewer invisible.
 * Without it there is a seam down the back of every room.
 */

type Props = {
  src: string;
  /** Described for a screen reader, which cannot look around. */
  label: string;
  /** Compass bearing the view opens on, so a room can face its best wall. */
  headingDeg?: number;
  className?: string;
};

const MIN_FOV = 35;
const MAX_FOV = 100;
const START_FOV = 78;
/** Straight up and straight down are disorienting and show the tripod. */
const MAX_PITCH = 75;

const VERT = `
attribute vec2 aPos;
varying vec2 vPos;
void main() { vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
varying vec2 vPos;
uniform sampler2D uImage;
uniform vec2 uHalfExtent;   // tan(fov/2), horizontal and vertical
uniform float uYaw;
uniform float uPitch;
const float PI = 3.141592653589793;

void main() {
  // The ray through this pixel, before the camera is turned.
  vec3 dir = normalize(vec3(vPos * uHalfExtent, -1.0));

  // Pitch about x, then yaw about y. In that order, so that looking up stays
  // level: yaw first would roll the horizon as soon as the view left centre.
  float cp = cos(uPitch), sp = sin(uPitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);

  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  gl_FragColor = texture2D(uImage, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI));
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/** Largest power of two at or below n, floored at 1. */
const pot = (n: number) => Math.max(1, 2 ** Math.floor(Math.log2(n)));

export function Panorama({ src, label, headingDeg = 0, className = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // Angles live in a ref, not state: they change on every animation frame while
  // a finger is down, and routing sixty re-renders a second through React to
  // set two floats a shader reads would be pure waste.
  const view = useRef({ yaw: (headingDeg * Math.PI) / 180, pitch: 0, fov: START_FOV });

  const [status, setStatus] = useState<"loading" | "ready" | "unsupported">("loading");
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext("webgl", { antialias: false, alpha: false })
      ?? canvas.getContext("experimental-webgl", { antialias: false, alpha: false })) as WebGLRenderingContext | null;
    if (!gl) { setStatus("unsupported"); return; }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) { setStatus("unsupported"); return; }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { setStatus("unsupported"); return; }
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uHalfExtent = gl.getUniformLocation(program, "uHalfExtent");
    const uYaw = gl.getUniformLocation(program, "uYaw");
    const uPitch = gl.getUniformLocation(program, "uPitch");

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // One gold pixel while the photograph downloads, so the frame is never a
    // black hole on a dark page.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([32, 28, 20]));

    let alive = true;
    let frame = 0;
    let ready = false;

    const draw = () => {
      if (!alive) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      gl.viewport(0, 0, w, h);

      const { yaw, pitch, fov } = view.current;
      // Vertical field of view is the fixed one; horizontal follows the shape
      // of the frame, so widening the window shows more room rather than
      // stretching what is already there.
      const halfY = Math.tan((fov * Math.PI) / 360);
      gl.uniform2f(uHalfExtent, halfY * (w / h), halfY);
      gl.uniform1f(uYaw, yaw);
      gl.uniform1f(uPitch, pitch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = requestAnimationFrame(draw);
    };

    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!alive) return;
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const width = Math.min(pot(image.naturalWidth), pot(max));
      const height = Math.max(1, width / 2);

      // Drawn through a 2D canvas rather than uploaded directly: this is both
      // the power-of-two resize WebGL 1 needs for the horizontal repeat, and
      // the guard against a 12,000px camera original blowing past the driver's
      // texture limit and failing silently.
      const scratch = document.createElement("canvas");
      scratch.width = width; scratch.height = height;
      const ctx = scratch.getContext("2d");
      if (!ctx) { setStatus("unsupported"); return; }
      ctx.drawImage(image, 0, 0, width, height);

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, scratch);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);      // no seam behind you
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ready = true;
      setStatus("ready");
    };
    image.onerror = () => alive && setStatus("unsupported");
    image.src = src;

    frame = requestAnimationFrame(draw);

    /* ---- looking around ---- */
    let dragging = false;
    let lastX = 0, lastY = 0;
    let pinch = 0;

    const clampPitch = (p: number) => {
      const limit = (MAX_PITCH * Math.PI) / 180;
      return Math.max(-limit, Math.min(limit, p));
    };
    /** Degrees of rotation per pixel dragged, at the current zoom. Tied to the
     *  field of view so that a zoomed-in view does not fly around. */
    const perPixel = () => (view.current.fov * Math.PI) / 180 / canvas.clientHeight;

    const down = (e: PointerEvent) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const k = perPixel();
      view.current.yaw -= (e.clientX - lastX) * k;
      view.current.pitch = clampPitch(view.current.pitch - (e.clientY - lastY) * k);
      lastX = e.clientX; lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const zoom = (by: number) => {
      view.current.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, view.current.fov + by));
    };
    const wheel = (e: WheelEvent) => {
      // Only while the viewer has been engaged, or scrolling past the page on a
      // trackpad would trap the reader inside the picture.
      if (document.activeElement !== canvas && !dragging) return;
      e.preventDefault();
      zoom(e.deltaY * 0.05);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch) zoom((pinch - d) * 0.15);
      pinch = d;
      e.preventDefault();
    };
    const touchEnd = () => { pinch = 0; };
    const key = (e: KeyboardEvent) => {
      const step = (view.current.fov * Math.PI) / 180 / 12;
      if (e.key === "ArrowLeft") view.current.yaw -= step;
      else if (e.key === "ArrowRight") view.current.yaw += step;
      else if (e.key === "ArrowUp") view.current.pitch = clampPitch(view.current.pitch + step);
      else if (e.key === "ArrowDown") view.current.pitch = clampPitch(view.current.pitch - step);
      else if (e.key === "+" || e.key === "=") zoom(-6);
      else if (e.key === "-") zoom(6);
      else return;
      e.preventDefault();
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("touchmove", touchMove, { passive: false });
    canvas.addEventListener("touchend", touchEnd);
    canvas.addEventListener("keydown", key);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("touchmove", touchMove);
      canvas.removeEventListener("touchend", touchEnd);
      canvas.removeEventListener("keydown", key);
      gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      void ready;
    };
  }, [src, headingDeg]);

  const toggleImmersive = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onChange = () => setImmersive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  if (status === "unsupported") {
    // Not a failure worth an error message: the flat photograph is still a
    // photograph of the room, and it is what a 360 image looks like unwrapped.
    return (
      <figure className={`relative overflow-hidden bg-ink-2 ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="h-full w-full object-cover" />
        <figcaption className="absolute inset-x-0 bottom-0 bg-ink/80 px-4 py-2 text-xs text-pale/70">
          Your browser can&rsquo;t show the 360° view, so this is the room flattened out.
        </figcaption>
      </figure>
    );
  }

  return (
    <div ref={shellRef} className={`relative overflow-hidden bg-ink-2 ${className}`}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={`${label}. A 360 degree view. Drag, or use the arrow keys, to look around.`}
        className="h-full w-full cursor-grab touch-none outline-none active:cursor-grabbing
                   focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-inset"
      />

      {status === "loading" && (
        <p className="absolute inset-0 grid place-items-center text-sm text-pale/60">
          Loading the room…
        </p>
      )}

      <p className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 bg-ink/70 px-3 py-1.5
                    text-[0.62rem] tracking-[0.18em] text-gold uppercase">
        <span aria-hidden="true">360°</span>
        <span className="text-pale/70 tracking-normal normal-case">Drag to look around</span>
      </p>

      <button
        type="button"
        onClick={toggleImmersive}
        className="absolute bottom-4 right-4 border border-white/20 bg-ink/70 px-3 py-1.5 text-xs
                   text-pale/85 transition-colors hover:border-gold hover:text-gold"
      >
        {immersive ? "Exit full screen" : "View full screen"}
      </button>
    </div>
  );
}
