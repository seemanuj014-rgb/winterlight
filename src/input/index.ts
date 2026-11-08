// Phase 18: the input layer, in one import. See the file heads for the details.
export { createInput, type Input, type InputEvents, type InputOptions, type GesturePayload, type PointerState } from './input';
export { createPicker, type Picker, type PickTarget } from './picking';
export { createTilt, type Tilt } from './tilt';
export { createHaptics, type Haptics } from './haptics';
export { GestureClassifier, GESTURE_DEFAULTS, normalizePointer, type GestureEvent, type PointerKind, type Sample } from './gestureMath';
export { choosePick, effectiveRadius, screenRadius, PICK_DEFAULTS } from './pickMath';
export { TiltFilter, blendParallax, nextTiltState, TILT_DEFAULTS, type TiltState } from './tiltMath';
export { HAPTIC_PATTERNS, HAPTIC_NAMES, type HapticName } from './hapticsMath';
export { KeyboardNav } from './keyboardMath';
