// Phase 17: the words on the loading and failure screens. They are plain, functional words, not the owner's letter (those live in `content/`).
// `index.html` carries the same sentences for the moments before any script has arrived (a test keeps the two in step).
// Tone: warm, short, no jargon, nothing that sounds like an error code.

export const BOOT_TEXT = {
  loading: 'Getting things ready',
  slow: 'Still loading. Your connection is a little slow, that is all.',
  stuck: 'This is taking longer than it should. You can keep waiting, or reload.',
  reload: 'Reload',
  noWebglTitle: 'This needs WebGL',
  noWebglBody: 'Your browser cannot draw 3D right now. Try this link in a recent Chrome, Safari or Firefox, and make sure hardware acceleration is turned on.',
  scriptFailTitle: 'It did not load',
  scriptFailBody: 'Something got stuck on the way. Check your connection, then reload the page.',
  contextLostTitle: 'The picture stopped',
  contextLostBody: 'Your phone paused the 3D drawing, maybe to save battery. It usually comes back by itself. If it does not, reload the page.',
  noscript: 'This needs JavaScript. Please turn it on and reload.',
} as const;

export type FailKind = 'webgl' | 'script' | 'context';

export function describeFailure(kind: FailKind): { title: string; body: string } {
  switch (kind) {
    case 'webgl':
      return { title: BOOT_TEXT.noWebglTitle, body: BOOT_TEXT.noWebglBody };
    case 'context':
      return { title: BOOT_TEXT.contextLostTitle, body: BOOT_TEXT.contextLostBody };
    default:
      return { title: BOOT_TEXT.scriptFailTitle, body: BOOT_TEXT.scriptFailBody };
  }
}
