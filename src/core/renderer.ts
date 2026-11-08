import * as THREE from 'three';
import { FpsWatchdog, pickInitialTier, settingsFor, type QualitySettings, type QualityTier } from './quality';
import { createDebugOverlay, readDebugParams, type DebugOverlay } from './debug';
import { createPost, supportsPost, type Post, type PostStats } from '../render/post/post';

export interface ResizeInfo {
  width: number;
  height: number;
  aspect: number;
  pixelRatio: number;
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
}

/** The one renderer. Every later phase draws through this; nothing else creates a WebGLRenderer. */
export interface Stage {
  readonly gl: THREE.WebGLRenderer;
  readonly tier: QualityTier;
  readonly settings: QualitySettings;
  readonly contextLost: boolean;
  /** Draws one frame and feeds the FPS watchdog. frameSec is the real frame time from the loop. */
  render(scene: THREE.Scene, camera: THREE.Camera, frameSec: number): void;
  /**
   * Phase 15: opt this view in to the post pass (bloom, and the grade on the high tier). Off by default, so Chamgadad's own views and the flat page draw exactly as before.
   * Only the mid and high tiers ever get it (PB), and only where the browser can draw into half-float targets; the low tier path is the plain renderer.
   */
  setPost(on: boolean): void;
  /** Phase 15: scale (0..1) on the glow the post pass adds back, for the current view. Kept across tier steps. No effect without the post pass. */
  setBloomGain(g: number): void;
  /** the post pass in use right now, or null (low tier, not opted in, or not supported) */
  readonly postStats: PostStats | null;
  /** Called now and on every size or pixel-ratio change. Returns an unsubscribe. */
  onResize(cb: (r: ResizeInfo) => void): () => void;
  /** Called when the watchdog steps the tier down (never up). */
  onTierChange(cb: (tier: QualityTier, settings: QualitySettings) => void): () => void;
  onContextLost(cb: () => void): () => void;
  onContextRestored(cb: () => void): () => void;
  dispose(): void;
}

function emitter<A extends unknown[]>() {
  const subs = new Set<(...a: A) => void>();
  return {
    add(cb: (...a: A) => void): () => void {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit(...a: A): void {
      for (const cb of [...subs]) cb(...a);
    },
  };
}

export function createStage(opts: StageOptions): Stage {
  const { canvas } = opts;
  const dbg = readDebugParams(window.location.search);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const startTier: QualityTier = dbg.tier ?? pickInitialTier(navigator.hardwareConcurrency || 4, nav.deviceMemory, opts.reducedMotion);

  let tier = startTier;
  let settings = settingsFor(tier);
  const watchdog = new FpsWatchdog(tier);
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
  const overlay: DebugOverlay | null = dbg.debug ? createDebugOverlay() : null;

  const resizeEv = emitter<[ResizeInfo]>();
  const tierEv = emitter<[QualityTier, QualitySettings]>();
  const lostEv = emitter<[]>();
  const restoredEv = emitter<[]>();

  let lost = false;
  let postWanted = false;
  let post: Post | null = null;
  let bloomGain = 1;
  let size: ResizeInfo = { width: 1, height: 1, aspect: 1, pixelRatio: 1 };

  function measure(force: boolean): void {
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio);
    if (!force && width === size.width && height === size.height && pixelRatio === size.pixelRatio) return;
    size = { width, height, aspect: width / height, pixelRatio };
    gl.setPixelRatio(pixelRatio);
    gl.setSize(width, height, false); // CSS owns the canvas size (100dvh), we only set the buffer
    post?.resize();
    resizeEv.emit(size);
  }

  /** The post pass exists only when the view asked for it, the tier allows it and the browser can do it. */
  function syncPost(): void {
    const want = postWanted && settings.postprocessing && supportsPost(gl);
    if (want && !post) {
      post = createPost(gl, tier, opts.reducedMotion);
      post.setBloomGain(bloomGain);
      gl.info.autoReset = false; // one frame is now several passes; we reset once per frame and count the scene pass apart from the post passes
    } else if (want && post) {
      post.setTier(tier);
    } else if (!want && post) {
      post.dispose();
      post = null;
      gl.info.autoReset = true;
    }
  }

  // Resize sources: the canvas box itself (covers 100dvh and URL-bar changes), the window
  // (covers browser zoom and DPR changes), orientation (iOS reports stale sizes, so re-check), visualViewport.
  const check = (): void => measure(false);
  const orient = (): void => {
    check();
    window.setTimeout(check, 250);
    window.setTimeout(check, 600);
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', orient);
  window.visualViewport?.addEventListener('resize', check);

  // Context loss. three.js re-initialises its own state and re-uploads resources on restore;
  // we stop drawing while lost and re-measure afterwards.
  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    lostEv.emit();
  };
  const onRestored = (): void => {
    lost = false;
    measure(true);
    restoredEv.emit();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  measure(true);

  return {
    gl,
    get tier() {
      return tier;
    },
    get settings() {
      return settings;
    },
    get contextLost() {
      return lost;
    },
    render(scene, camera, frameSec) {
      if (lost) return;
      let sceneCalls: number | undefined;
      let sceneTriangles: number | undefined;
      if (post) {
        gl.info.reset();
        post.render(scene, camera);
        gl.setRenderTarget(null);
        sceneCalls = post.lastScene.calls;
        sceneTriangles = post.lastScene.triangles;
      } else gl.render(scene, camera);
      overlay?.update(frameSec, gl, scene, {
        tier,
        startTier,
        pixelRatio: size.pixelRatio,
        width: size.width,
        height: size.height,
        contextLost: lost,
        sceneCalls,
        sceneTriangles,
        post: post ? post.stats : postWanted ? null : undefined,
      });
      const next = frameSec > 0 ? watchdog.push(frameSec * 1000) : null;
      if (next) {
        tier = next;
        settings = settingsFor(next);
        measure(true); // new pixel-ratio cap
        syncPost(); // low drops the post pass altogether; mid from high rebuilds it smaller
        tierEv.emit(tier, settings);
      }
    },
    setPost(on) {
      postWanted = on;
      syncPost();
    },
    setBloomGain(g) {
      bloomGain = Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 1;
      post?.setBloomGain(bloomGain);
    },
    get postStats() {
      return post ? post.stats : null;
    },
    onResize(cb) {
      cb(size);
      return resizeEv.add(cb);
    },
    onTierChange: tierEv.add,
    onContextLost: lostEv.add,
    onContextRestored: restoredEv.add,
    dispose() {
      ro?.disconnect();
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', orient);
      window.visualViewport?.removeEventListener('resize', check);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      overlay?.dispose();
      post?.dispose();
      gl.dispose();
    },
  };
}
