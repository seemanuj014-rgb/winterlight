import type { ConstellationDef } from '../defs';
import { STRAWBERRY } from './strawberry';
import { BUMBLEBEE } from './bumblebee';
import { FROST_ROSE } from './frostRose';
import { DIAMOND } from './diamond';
import { CAT_AND_BUNNY } from './catAndBunny';

// Phase 22: the five shapes, keyed by the `shape` field of content/names.json. Pure data.
export const SHAPES: Record<string, ConstellationDef> = {
  strawberry: STRAWBERRY,
  bumblebee: BUMBLEBEE,
  'frost-rose': FROST_ROSE,
  diamond: DIAMOND,
  'cat-and-bunny': CAT_AND_BUNNY,
};

/** the discovery order (low and near to high and grand): the order of content/names.json */
export const SHAPE_ORDER: readonly string[] = ['strawberry', 'bumblebee', 'rose', 'kaaju-katli', 'cutie-patootie'];

export { STRAWBERRY, BUMBLEBEE, FROST_ROSE, DIAMOND, CAT_AND_BUNNY };
