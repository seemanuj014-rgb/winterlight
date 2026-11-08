import { describe, it, expect } from 'vitest';
import { detectInApp, detectOS, inAppNote } from '../src/core/platform';

const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IOS_INSTA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0';
const PIXEL_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 13; SM-A546E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36';
const FB = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36 [FBAN/FB4A;FBAV/450.0]';

describe('platform', () => {
  it('real browsers get no note', () => {
    expect(detectInApp(IOS_SAFARI)).toBeNull();
    expect(detectInApp(PIXEL_CHROME)).toBeNull();
    expect(detectInApp('')).toBeNull();
  });
  it('chat-app browsers are found', () => {
    expect(detectInApp(IOS_INSTA)).toBe('Instagram');
    expect(detectInApp(FB)).toBe('Facebook');
    expect(detectInApp(ANDROID_WV)).toBe('an app');
    expect(detectInApp('x WhatsApp/2.24 y')).toBe('WhatsApp');
  });
  it('the note names the right browser for the phone', () => {
    expect(detectOS(IOS_SAFARI)).toBe('ios');
    expect(detectOS(PIXEL_CHROME)).toBe('android');
    expect(inAppNote('ios').text).toContain('Safari');
    expect(inAppNote('android').text).toContain('Chrome');
    expect(inAppNote('other').text).toContain('your browser');
  });
});
