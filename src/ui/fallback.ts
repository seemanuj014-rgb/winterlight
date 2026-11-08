// Phase 33: the gentle "open in your browser" note, shown once inside chat-app browsers. DOM only; the words come from core/platform.ts.
import { detectInApp, detectOS, inAppNote } from '../core/platform';

export function showInAppNote(ua: string = navigator.userAgent, doc: Document = document): HTMLElement | null {
  if (!detectInApp(ua)) return null;
  const note = inAppNote(detectOS(ua));
  const box = doc.createElement('div');
  box.id = 'inapp-note';
  box.setAttribute('role', 'status');
  box.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:calc(12px + var(--safe-bottom,0px));z-index:20;max-width:420px;margin:0 auto;padding:12px 14px;' +
    'border-radius:14px;background:rgba(13,27,46,.94);color:#cfe3f2;font:14px/1.45 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);';
  const p = doc.createElement('p');
  p.style.margin = '0 0 8px';
  p.textContent = note.text;
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = note.dismiss;
  b.style.cssText = 'font:inherit;color:#0d1b2e;background:#cfe3f2;border:0;border-radius:999px;padding:7px 18px;touch-action:manipulation;';
  b.addEventListener('click', () => box.remove());
  box.append(p, b);
  doc.body.append(box);
  return box;
}
