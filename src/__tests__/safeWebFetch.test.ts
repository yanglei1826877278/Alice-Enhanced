import { beforeEach, describe, expect, it, vi } from 'vitest'

const { axiosGet, dnsLookup } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  dnsLookup: vi.fn(),
}))

vi.mock('axios', () => ({ default: { get: axiosGet } }))
vi.mock('node:dns/promises', () => ({
  default: { lookup: dnsLookup },
}))

import {
  fetchPublicText,
  validatePublicWebUrl,
} from '../../electron/main/safeWebFetch'

describe('safe web fetch', () => {
  beforeEach(() => {
    axiosGet.mockReset()
    dnsLookup.mockReset()
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it.each([
    'file:///etc/passwd',
    'https://user:secret@example.com/',
    'http://localhost/admin',
    'http://127.0.0.1/private',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://[::ffff:a9fe:a9fe]/',
  ])('blocks unsafe destination %s', async url => {
    await expect(validatePublicWebUrl(url)).rejects.toThrow()
  })

  it('rejects a hostname when any resolved address is private', async () => {
    dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
    await expect(validatePublicWebUrl('https://example.com')).rejects.toThrow(
      'private network'
    )
  })

  it('extracts HTML text, truncates it, and uses bounded requests', async () => {
    axiosGet.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: Buffer.from('<html><body>Hello <script>secret()</script>world</body></html>'),
    })
    const result = await fetchPublicText({
      url: 'https://example.com/page',
      maxChars: 8,
      timeoutMs: 99_000,
    })
    expect(result.text).toBe('Hello wo')
    expect(result.truncated).toBe(true)
    expect(axiosGet).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({
        timeout: 30_000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        proxy: false,
      })
    )
  })

  it('revalidates redirects and blocks a redirect to metadata', async () => {
    axiosGet.mockResolvedValue({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
      data: Buffer.alloc(0),
    })
    await expect(
      fetchPublicText({ url: 'https://example.com/redirect' })
    ).rejects.toThrow('private network')
    expect(axiosGet).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized and non-text responses', async () => {
    axiosGet.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: Buffer.alloc(1024 * 1024 + 1),
    })
    await expect(fetchPublicText({ url: 'https://example.com/big' })).rejects.toThrow(
      'too large'
    )

    axiosGet.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      data: Buffer.from('binary'),
    })
    await expect(fetchPublicText({ url: 'https://example.com/file' })).rejects.toThrow(
      'Unsupported response content type'
    )
  })
})
