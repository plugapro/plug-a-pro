import { describe, expect, it } from 'vitest'
import { isDesktopBrowserUserAgent } from '@/lib/admin-desktop-policy'

const VODAPAY_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 AlipayClient/10.3.0 MiniProgram'
const VODAPAY_DESKTOPISH =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 AlipayClient/10.3.0 MiniProgram'

describe('mini-program user agents', () => {
  it('android mini-program UA is not desktop', () => {
    expect(isDesktopBrowserUserAgent(VODAPAY_ANDROID)).toBe(false)
  })
  it('MiniProgram marker fails open even on a desktop-looking UA', () => {
    expect(isDesktopBrowserUserAgent(VODAPAY_DESKTOPISH)).toBe(false)
  })
  it('plain desktop stays desktop', () => {
    expect(
      isDesktopBrowserUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'),
    ).toBe(true)
  })
})
