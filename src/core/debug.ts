import type * as THREE from 'three';
import type { QualityTier } from './quality';

/** `?debug` turns the overlay on. `?debug&tier=low|mid|high` forces the starting tier (debug only). */
export function readDebugParams(search: string): { debug: boolean; tier: QualityTier | null } {
  const p = new URLSearchParams(search);
  if (!p.has('debug')) return { debug: false, tier: null };
  const t = p.get('tier');
  return { debug: true, tier: t === 'low' || t === 'mid' || t === 'high' ? t : null };
}

export interface DebugStats {
  tier: QualityTier;
  startTier: QualityTier;
  fps: number;
  calls: number;
  triangles: number;
  textureMB: number;
  pixelRatio: number;
  width: number;
  height: number;
  contextLost: boolean;
  /** Phase 15: the post pass in use (null = this view asks for it but this tier or browser has none; undefined = this view does not use one) */
  post?: { passes: number; msaa: number; bloomLevels: number; memoryMB: number } | null;
}

export function formatDebugLines(s: DebugStats): string[] {
  return [
    `tier   ${s.tier}${s.tier !== s.startTier ? ` (started ${s.startTier})` : ''}`,
    `fps    ${s.fps.toFixed(0)} (${s.fps > 0 ? (1000 / s.fps).toFixed(1) : '-'} ms)`,
    `calls  ${s.calls}`,
    `tris   ${s.triangles}`,
    `tex    ~${s.textureMB.toFixed(1)} MB`,
    `canvas ${s.width}x${s.height} @${s.pixelRatio.toFixed(2)}`,
    ...(s.post === undefined ? [] : [s.post === null ? 'post   off' : `post   +${s.post.passes} passes, bloom x${s.post.bloomLevels}, msaa ${s.post.msaa}, ~${s.post.memoryMB.toFixed(1)} MB buffers`]),
    ...(s.contextLost ? ['WEBGL CONTEXT LOST'] : []),
  ];
}

/** Rough texture memory of what the scene references (w*h*4, +1/3 for mipmaps). Render targets are not counted. */
export function estimateTextureMB(scene: THREE.Scene): number {
  const seen = new Set<THREE.Texture>();
  const add = (v: unknown): void => {
    if (v && (v as THREE.Texture).isTexture) seen.add(v as THREE.Texture);
  };
  add(scene.background);
  add(scene.environment);
  scene.traverse((obj) => {
    const m = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) for (const v of Object.values(mat)) add(v);
  });
  let bytes = 0;
  for (const t of seen) {
    const img = t.image as { width?: number; height?: number } | null | undefined;
    if (!img || Array.isArray(img) || !img.width || !img.height) continue;
    bytes += img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  }
  return bytes / (1024 * 1024);
}

export interface DebugOverlay {
  update(
    frameSec: number,
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    info: Omit<DebugStats, 'fps' | 'calls' | 'triangles' | 'textureMB'> & { sceneCalls?: number; sceneTriangles?: number },
  ): void;
  dispose(): void;
}

export function createDebugOverlay(): DebugOverlay {
  const el = document.createElement('pre');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    left: 'calc(env(safe-area-inset-left, 0px) + 6px)',
    top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
    margin: '0',
    padding: '6px 8px',
    font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
    color: '#cfe3f2',
    background: 'rgba(0,0,0,.55)',
    borderRadius: '6px',
    pointerEvents: 'none',
    zIndex: '9999',
    whiteSpace: 'pre',
  });
  document.body.appendChild(el);

  let frames = 0;
  let elapsed = 0;
  let fps = 0;
  return {
    update(frameSec, gl, scene, info) {
      if (frameSec > 0) {
        frames++;
        elapsed += frameSec;
      }
      if (elapsed < 0.5) return;
      fps = frames / elapsed;
      frames = 0;
      elapsed = 0;
      const { sceneCalls, sceneTriangles, ...rest } = info;
      el.textContent = formatDebugLines({
        ...rest,
        fps,
        // with the post pass on, `calls` and `tris` are the SCENE's own (what PB budgets); the post passes are on their own line
        calls: sceneCalls ?? gl.info.render.calls,
        triangles: sceneTriangles ?? gl.info.render.triangles,
        textureMB: estimateTextureMB(scene),
      }).join('\n');
    },
    dispose() {
      el.remove();
    },
  };
}
