import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

// Import boundaries from PROJECT_STRUCTURE.md. Pure checker + a scan of the real src/.

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

/** files: path relative to src (posix) -> source text. Returns human-readable violations. */
export function findViolations(files: Record<string, string>): string[] {
  const out: string[] = [];
  const PURE = new Set(['core/quality.ts', 'core/platform.ts', 'core/power.ts', 'core/silhouette.ts', 'core/loop.ts', 'core/directorMath.ts', 'core/bootTasks.ts', 'ui/bootMath.ts', 'ui/bootText.ts', 'ui/themeMath.ts', 'world/shots.ts', 'input/gestureMath.ts', 'input/pickMath.ts', 'input/tiltMath.ts', 'input/hapticsMath.ts', 'input/keyboardMath.ts', 'acts/actsMath.ts', 'interaction/petMath.ts', 'constellations/engine.ts', 'constellations/defs.ts', 'constellations/routeMath.ts', 'constellations/skyLayoutMath.ts', 'audio/audioMath.ts', 'audio/blow.ts', 'acts/cakeMath.ts', 'world/cakeMath.ts', 'fx/lanternMath.ts', 'fx/glitterMath.ts', 'fx/releaseMath.ts', 'acts/letterMath.ts', 'world/envelopeMath.ts', 'acts/finaleMath.ts', 'acts/finaleSkyMath.ts', 'acts/stayAwhileMath.ts', 'acts/stayWorldMath.ts', 'acts/stayBudgetMath.ts', 'acts/stayCastMath.ts', 'acts/cardMath.ts']);
  for (const [file, text] of Object.entries(files)) {
    const area = file.includes('/') ? file.split('/')[0]! : '';
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      const isThree = spec === 'three' || spec.startsWith('three/');
      let target = '';
      if (spec.startsWith('.')) {
        const rel = relative('src', resolve('src', dirname(file), spec)).split(sep);
        target = rel[0] ?? '';
        if (rel.length === 1 && rel[0] === 'main') target = 'main.ts';
        if (rel[0] === '..') target = ''; // data files outside src/ (character/*.json, content/): not an area, always allowed
      }
      if (area === 'core' && ['world', 'character', 'acts', 'ui', 'input'].includes(target)) out.push(`${file}: core must not import ${target}`);
      if ((area === 'content' || area === 'state') && isThree) out.push(`${file}: ${area} must not import three`);
      if (area === 'input' && ['world', 'character', 'acts', 'ui'].includes(target)) out.push(`${file}: input must not import ${target}`);
      if (area === 'character' && target && !['render', 'core', 'character'].includes(target)) out.push(`${file}: character may import render/ and core/ only, not ${target}`);
      if (target === 'acts' && area !== 'acts' && file !== 'main.ts') out.push(`${file}: only main.ts may import acts`);
      if (area === 'interaction' && ['acts', 'ui'].includes(target)) out.push(`${file}: interaction must not import ${target}`);
      if (target === 'interaction' && area !== 'interaction' && area !== 'acts' && file !== 'main.ts') out.push(`${file}: only main.ts and acts may import interaction`);
      if (area === 'constellations' && ['acts', 'ui', 'character', 'interaction', 'core'].includes(target)) out.push(`${file}: constellations must not import ${target}`);
      if (area === 'constellations' && file === 'constellations/engine.ts' && target && target !== 'constellations') out.push(`${file}: the engine imports nothing outside constellations/`);
      if (target === 'constellations' && !['constellations', 'acts', ''].includes(area) && !['main.ts', 'starsView.ts', 'skyView.ts'].includes(file)) out.push(`${file}: only main.ts, starsView.ts, skyView.ts and acts may import constellations`);
      if (area === 'audio' && ['world', 'character', 'acts', 'ui', 'input', 'interaction', 'constellations', 'core', 'render'].includes(target)) out.push(`${file}: audio must not import ${target}`);
      if (area === 'audio' && isThree) out.push(`${file}: audio must not import three`);
      if (target === 'audio' && area !== 'audio' && area !== 'acts' && !['main.ts', 'audioView.ts'].includes(file)) out.push(`${file}: only main.ts, audioView.ts and acts may import audio`);
      if (PURE.has(file) && isThree) out.push(`${file}: pure logic must not import three`);
    }
  }
  return out;
}

function readAll(dir: string, base = dir, acc: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readAll(p, base, acc);
    else if (p.endsWith('.ts')) acc[relative(base, p).split(sep).join('/')] = readFileSync(p, 'utf8');
  }
  return acc;
}

describe('import boundaries', () => {
  it('the real src/ respects them', () => {
    expect(findViolations(readAll('src'))).toEqual([]);
  });
  it('the checker catches each kind of violation', () => {
    const bad = findViolations({
      'core/a.ts': "import { x } from '../world/sky';",
      'content/b.ts': "import * as THREE from 'three';",
      'state/c.ts': "import { Vector3 } from 'three';",
      'character/d.ts': "import { y } from '../world/terrain';",
      'ui/e.ts': "import { z } from '../acts/act1';",
      'core/quality.ts': "import * as THREE from 'three';",
      'input/f.ts': "import { x } from '../character/chamgadad/body';",
      'core/g.ts': "import { x } from '../input/input';",
      'input/pickMath.ts': "import * as THREE from 'three';",
      'interaction/pet.ts': "import { h } from '../acts/hud';",
      'world/w.ts': "import { p } from '../interaction/pet';",
      'interaction/petMath.ts': "import * as THREE from 'three';",
      'constellations/fx.ts': "import { c } from '../acts/hud';",
      'constellations/engine.ts': "import * as THREE from 'three';",
      'world/x.ts': "import { c } from '../constellations/index';",
    });
    expect(bad).toHaveLength(17);
  });
  it('the checker allows what is allowed', () => {
    const ok = findViolations({
      'main.ts': "import { a } from './acts/act1';\nimport * as THREE from 'three';",
      'acts/act1.ts': "import { b } from '../world/sky';\nimport { c } from './act2';\nimport { d } from '../interaction/pet';",
      'interaction/pet.ts': "import { w } from '../world/shots';\nimport { i } from '../input/input';\nimport { x } from '../character/cat/cat';",
      'character/d.ts': "import { r } from '../render/toon';\nimport { q } from '../core/quality';",
      'constellations/index.ts': "import { p } from '../input';\nimport { b } from '../state/events';\nimport { e } from './engine';",
      'starsView.ts': "import { p } from './constellations';\nimport { b } from './world/backdrop';",
      'input/picking.ts': "import * as THREE from 'three';\nimport { choosePick } from './pickMath';",
      'input/input.ts': "import { createBus } from '../state/events';",
      'core/renderer.ts': "import * as THREE from 'three';\nimport { q } from './quality';",
      'core/debug.ts': "import type * as THREE from 'three';",
      'character/chamgadad/head.ts': "import palette from '../../../character/palette.json';\nimport p from '../../../character/traced/x.parts.json';",
    });
    expect(ok).toEqual([]);
  });
});
