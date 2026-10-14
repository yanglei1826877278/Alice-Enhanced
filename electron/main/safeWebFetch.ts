import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import axios from 'axios'
import * as cheerio from 'cheerio'

const MAX_REDIRECTS = 3
const MAX_RESPONSE_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 30_000
const MAX_TEXT_CHARS = 50_000

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    )
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase()
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length)
      if (net.isIPv4(mapped)) return isPrivateIp(mapped)
      const groups = mapped.split(':')
      if (groups.length === 2) {
        const high = Number.parseInt(groups[0], 16)
        const low = Number.parseInt(groups[1], 16)
        if (Number.isFinite(high) && Number.isFinite(low)) {
          return isPrivateIp(
            `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
          )
        }
      }
      return true
    }
    const first = Number.parseInt(normalized.split(':')[0], 16)
    return (
      normalized === '::' ||
      normalized === '::1' ||
      !Number.isFinite(first) ||
      first < 0x2000 ||
      first > 0x3fff ||
      normalized.startsWith('2001:db8:')
    )
  }
  return true
}

export async function validatePublicWebUrl(
  rawUrl: string
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('web_fetch only supports http and https URLs.')
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed.')
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Local and private network destinations are blocked.')
  }

  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true, verbatim: true })).map(
        entry => entry.address
      )
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new Error('Local and private network destinations are blocked.')
  }
  return { url, addresses }
}

function extractText(body: Buffer, contentType: string): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(body)
  if (contentType.includes('text/html')) {
    const $ = cheerio.load(decoded)
    $('script, style, noscript, svg').remove()
    return $('body').text().replace(/\s+/g, ' ').trim()
  }
  return decoded.trim()
}

export async function fetchPublicText(args: {
  url: string
  maxChars?: number
  timeoutMs?: number
}): Promise<{
  url: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}> {
  let currentUrl = args.url
  const timeout = Math.min(
    Math.max(1_000, args.timeoutMs || DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_MS
  )
  const maxChars = Math.min(
    Math.max(1, args.maxChars || 20_000),
    MAX_TEXT_CHARS
  )

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const validated = await validatePublicWebUrl(currentUrl)
    let addressIndex = 0
    const lookup = (
      _hostname: string,
      _options: unknown,
      callback: (error: Error | null, address: string, family: number) => void
    ) => {
      const address = validated.addresses[addressIndex++ % validated.addresses.length]
      callback(null, address, net.isIPv6(address) ? 6 : 4)
    }
    const response = await axios.get<ArrayBuffer>(validated.url.toString(), {
      responseType: 'arraybuffer',
      timeout,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      validateStatus: () => true,
      proxy: false,
      httpAgent: new http.Agent({ lookup: lookup as any }),
      httpsAgent: new https.Agent({ lookup: lookup as any }),
      headers: {
        Accept: 'text/html,text/plain,application/json,application/xml;q=0.8',
        'User-Agent': 'Alice-Agent/1.0',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location
      if (!location) throw new Error('Redirect response did not include a location.')
      if (redirect === MAX_REDIRECTS) throw new Error('Too many redirects.')
      currentUrl = new URL(location, validated.url).toString()
      continue
    }

    const contentType = String(response.headers['content-type'] || '')
      .split(';')[0]
      .toLowerCase()
    if (
      !contentType.startsWith('text/') &&
      !['application/json', 'application/xml', 'application/xhtml+xml'].includes(
        contentType
      )
    ) {
      throw new Error(`Unsupported response content type: ${contentType || 'unknown'}.`)
    }
    const body = Buffer.from(response.data)
    if (body.length > MAX_RESPONSE_BYTES) throw new Error('Response body is too large.')
    const fullText = extractText(body, contentType)
    return {
      url: validated.url.toString(),
      status: response.status,
      contentType,
      text: fullText.slice(0, maxChars),
      truncated: fullText.length > maxChars,
    }
  }
  throw new Error('Too many redirects.')
}
