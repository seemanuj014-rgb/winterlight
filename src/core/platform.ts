// Phase 33: what browser is this? Pure: takes the user-agent string, touches nothing.
// Only used to show a gentle "open in your browser" note inside chat-app browsers, where
// audio, the microphone and the gyro are often blocked. Nothing is ever refused.

export type OS = 'ios' | 'android' | 'other';

export function detectOS(ua: string): OS {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** The name of the app whose built-in browser this is, or null for a normal browser. Best effort: a miss only means no note. */
export function detectInApp(ua: string): string | null {
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/MicroMessenger/i.test(ua)) return 'WeChat';
  if (/\bLine\//i.test(ua)) return 'Line';
  if (/Telegram/i.test(ua)) return 'Telegram';
  // Android WebView (what most chat apps use) marks itself with "; wv)". A real Chrome never does.
  if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return 'an app';
  return null;
}

export function inAppNote(os: OS): { text: string; dismiss: string } {
  const where = os === 'ios' ? 'Safari' : os === 'android' ? 'Chrome' : 'your browser';
  return {
    text: `This works best in ${where}. Tap the menu or share button and choose "Open in ${where}". Sound and tilt may not work in this window.`,
    dismiss: 'Got it',
  };
}
