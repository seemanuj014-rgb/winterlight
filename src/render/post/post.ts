import * as THREE from 'three';
import { BLOOM_MID, levelSize, postMemoryMB, postPassCount, postPlanFor, type PostPlan, type Tier } from './postMath';
import { BLUR_FRAG, BRIGHT_FRAG, COMPOSITE_FRAG, DOWN_FRAG, POST_VERT } from './shaders';

// Phase 15: the post pass. The scene is drawn into a half-float buffer that holds DISPLAY-ENCODED (sRGB) values, not linear ones: every shader in this project blends
// its soft things (aurora, smoke, flakes, glow) in the encoded space when it draws straight to the screen (the low tier), and a linear buffer would blend them
// differently and make the mid and high tiers look brighter than low. To get the same look, the scene target is marked so that three.js encodes inside the material
// (it does that for XR targets), and the composite writes the values as they are. Half-float keeps values above 1 for the bloom,
// the bright pass keeps only the warm and aurora highlights (AD), they are blurred at half resolution (and again at a quarter on the high tier),
// and one composite adds them back, applies the grade (high tier) and does the single encode to the screen.
// Low tier: this object is never created, the renderer draws straight to the screen, exactly as before.
// No new geometry in the scene, no textures: only render targets, which `?debug` reports separately.

export interface PostStats {
  /** draw calls of the post passes only (the scene's own are counted apart) */
  passes: number;
  /** scene buffer samples (MSAA) */
  msaa: number;
  bloomLevels: number;
  /** render-target memory in MB (estimate) */
  memoryMB: number;
}

export interface Post {
  readonly plan: PostPlan;
  readonly stats: PostStats;
  /** draw calls and triangles of the SCENE pass of the last frame (before the post passes) */
  readonly lastScene: { calls: number; triangles: number };
  /** call on every size or pixel-ratio change (reads the renderer's drawing buffer size) */
  resize(): void;
  /** per-view scale on how much glow is added back (1 = the plan's own strength). A small lit room needs less than a wide night. */
  setBloomGain(g: number): void;
  /** only ever steps down: it rebuilds the buffers for the new plan */
  setTier(tier: Tier): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

/** True when this browser can draw into half-float targets. If not, the caller keeps the no-post path (the card still looks right, only without bloom). */
export function supportsPost(gl: THREE.WebGLRenderer): boolean {
  return gl.capabilities.isWebGL2 && (gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float'));
}

function fullscreenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

function passMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: POST_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}

export function createPost(gl: THREE.WebGLRenderer, startTier: Tier, reducedMotion: boolean): Post {
  let plan = postPlanFor(startTier, reducedMotion);
  const floatMsaa = gl.extensions.has('EXT_color_buffer_float'); // multisampled half-float renderbuffers need this one

  const tri = new THREE.Mesh(fullscreenTriangle());
  tri.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  quadScene.add(tri);

  const linearTarget = (w: number, h: number, samples: number, depth: boolean): THREE.WebGLRenderTarget => {
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      stencilBuffer: false,
      generateMipmaps: false,
      samples,
    });
    t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  /** The scene target: materials encode to sRGB as they draw into it (see the header). Pinned to three 0.187, where the program's output colour space is read from this flag. */
  const sceneTarget = (w: number, h: number, samples: number): THREE.WebGLRenderTarget => {
    const t = linearTarget(w, h, samples, true);
    t.texture.colorSpace = THREE.SRGBColorSpace;
    (t as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    return t;
  };

  const uBright = {
    tSource: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: BLOOM_MID.threshold },
    uKnee: { value: BLOOM_MID.knee },
    uChroma: { value: new THREE.Vector2(BLOOM_MID.chroma[0], BLOOM_MID.chroma[1]) },
  };
  const uDown = { tSource: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2() } };
  const uBlur = { tSource: { value: null as THREE.Texture | null }, uStep: { value: new THREE.Vector2() } };
  const uComp = {
    tScene: { value: null as THREE.Texture | null },
    tBloom0: { value: null as THREE.Texture | null },
    tBloom1: { value: null as THREE.Texture | null },
    uBloom: { value: new THREE.Vector2() },
    uGrade: { value: 0 },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uSplit: { value: 0 },
    uVignette: { value: 0 },
    uVignetteStart: { value: 0.5 },
    uAspect: { value: new THREE.Vector2(1, 1) },
    uDither: { value: 0 },
  };
  const brightMat = passMaterial(BRIGHT_FRAG, uBright);
  const downMat = passMaterial(DOWN_FRAG, uDown);
  const blurMat = passMaterial(BLUR_FRAG, uBlur);
  const compMat = passMaterial(COMPOSITE_FRAG, uComp);

  let sceneRT: THREE.WebGLRenderTarget | null = null;
  let ping: THREE.WebGLRenderTarget[] = [];
  let pong: THREE.WebGLRenderTarget[] = [];
  let gain = 1;
  let bufW = 0;
  let bufH = 0;
  const size = new THREE.Vector2();
  const lastScene = { calls: 0, triangles: 0 };

  const freeTargets = (): void => {
    sceneRT?.dispose();
    for (const t of [...ping, ...pong]) t.dispose();
    sceneRT = null;
    ping = [];
    pong = [];
  };

  const build = (): void => {
    freeTargets();
    gl.getDrawingBufferSize(size);
    bufW = Math.max(2, Math.floor(size.x));
    bufH = Math.max(2, Math.floor(size.y));
    if (!plan.enabled) return;
    sceneRT = sceneTarget(bufW, bufH, floatMsaa ? plan.msaa : 0);
    if (plan.bloom) {
      for (let l = 0; l < plan.bloom.levels; l++) {
        const s = levelSize(bufW, bufH, plan.bloom.scale, l);
        ping.push(linearTarget(s.w, s.h, 0, false));
        pong.push(linearTarget(s.w, s.h, 0, false));
      }
    }
  };

  const draw = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void => {
    tri.material = mat;
    gl.setRenderTarget(target);
    gl.render(quadScene, camera);
  };

  const blur = (level: number, radius: number): void => {
    const a = ping[level]!;
    const b = pong[level]!;
    uBlur.tSource.value = a.texture;
    uBlur.uStep.value.set((radius * 1) / a.width, 0);
    draw(blurMat, b);
    uBlur.tSource.value = b.texture;
    uBlur.uStep.value.set(0, (radius * 1) / a.height);
    draw(blurMat, a);
  };

  const applyGradeUniforms = (): void => {
    const g = plan.grade;
    uComp.uGrade.value = g.enabled ? 1 : 0;
    uComp.uExposure.value = g.exposure;
    uComp.uSaturation.value = g.saturation;
    uComp.uContrast.value = g.contrast;
    uComp.uShadowTint.value.set(...g.shadowTint);
    uComp.uHighlightTint.value.set(...g.highlightTint);
    uComp.uSplit.value = g.split;
    uComp.uVignette.value = g.vignette;
    uComp.uVignetteStart.value = g.vignetteStart;
    uComp.uDither.value = g.dither;
    const bl = plan.bloom;
    if (bl) {
      uBright.uThreshold.value = bl.threshold;
      uBright.uKnee.value = bl.knee;
      uBright.uChroma.value.set(bl.chroma[0], bl.chroma[1]);
      uComp.uBloom.value.set(bl.strength[0] * gain, bl.levels === 2 ? bl.strength[1] * gain : 0);
    } else uComp.uBloom.value.set(0, 0);
  };

  build();
  applyGradeUniforms();

  const post: Post = {
    get plan() {
      return plan;
    },
    get stats() {
      return { passes: postPassCount(plan), msaa: floatMsaa ? plan.msaa : 0, bloomLevels: plan.bloom?.levels ?? 0, memoryMB: postMemoryMB(plan, bufW, bufH) };
    },
    lastScene,
    resize() {
      gl.getDrawingBufferSize(size);
      if (Math.floor(size.x) === bufW && Math.floor(size.y) === bufH && sceneRT) return;
      build();
    },
    setBloomGain(g) {
      gain = Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 1;
      applyGradeUniforms();
    },
    setTier(tier) {
      const next = postPlanFor(tier, reducedMotion);
      if (next.enabled === plan.enabled && next.msaa === plan.msaa && next.bloom === plan.bloom && next.grade === plan.grade) return;
      plan = next;
      build();
      applyGradeUniforms();
    },
    render(scene, camera3d) {
      if (!plan.enabled || !sceneRT) {
        gl.setRenderTarget(null);
        gl.render(scene, camera3d);
        lastScene.calls = gl.info.render.calls;
        lastScene.triangles = gl.info.render.triangles;
        return;
      }
      gl.setRenderTarget(sceneRT);
      gl.render(scene, camera3d);
      lastScene.calls = gl.info.render.calls;
      lastScene.triangles = gl.info.render.triangles;

      const bl = plan.bloom;
      if (bl) {
        const s0 = ping[0]!;
        uBright.tSource.value = sceneRT.texture;
        uBright.uTexel.value.set(0.5 / bufW, 0.5 / bufH);
        draw(brightMat, s0);
        blur(0, bl.radius);
        if (bl.levels === 2 && ping[1]) {
          uDown.tSource.value = s0.texture;
          uDown.uTexel.value.set(1 / s0.width, 1 / s0.height);
          draw(downMat, ping[1]);
          blur(1, bl.radius);
        }
        uComp.tBloom0.value = ping[0]!.texture;
        uComp.tBloom1.value = ping[1]?.texture ?? ping[0]!.texture;
      }
      uComp.tScene.value = sceneRT.texture;
      const aspect = bufW / bufH;
      uComp.uAspect.value.set(Math.min(1, aspect), Math.min(1, 1 / aspect));
      draw(compMat, null);
    },
    dispose() {
      freeTargets();
      tri.geometry.dispose();
      for (const m of [brightMat, downMat, blurMat, compMat]) m.dispose();
      gl.setRenderTarget(null);
    },
  };
  return post;
}
