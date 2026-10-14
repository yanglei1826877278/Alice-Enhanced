import { gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import WebSocket from 'ws'

const ASR_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream'
const RESOURCE_ID = 'volc.seedasr.sauc.duration'
const AUDIO_CHUNK_BYTES = 6400 // 200 ms of 16 kHz, 16-bit mono audio

/** Volcengine v3 frames: four-byte header, optional sequence, length, payload. */
export function encodeAsrFrame(
  messageType: number,
  flags: number,
  serialization: number,
  payload: Buffer
): Buffer {
  const frame = Buffer.allocUnsafe(8 + payload.length)
  frame[0] = 0x11
  frame[1] = (messageType << 4) | flags
  frame[2] = serialization << 4 // no compression
  frame[3] = 0
  frame.writeUInt32BE(payload.length, 4)
  payload.copy(frame, 8)
  return frame
}

export function decodeAsrFrame(frame: Buffer): {
  last: boolean
  errorCode?: number
  payload: unknown
} {
  if (frame.length < 8 || frame[0] >> 4 !== 1)
    throw new Error('Doubao ASR returned an invalid protocol frame.')
  const type = frame[1] >> 4
  const flags = frame[1] & 0x0f
  const compression = frame[2] & 0x0f
  let offset = (frame[0] & 0x0f) * 4
  if (offset < 4 || offset > frame.length - 4)
    throw new Error('Doubao ASR returned an invalid frame header.')
  let sequence: number | undefined
  if (type === 0x0f || flags & 0x01) {
    if (offset + 4 > frame.length)
      throw new Error('Invalid ASR frame sequence.')
    sequence = frame.readInt32BE(offset)
    offset += 4
  }
  if (offset + 4 > frame.length) throw new Error('Invalid ASR frame length.')
  const length = frame.readUInt32BE(offset)
  offset += 4
  if (length > frame.length - offset)
    throw new Error('Doubao ASR returned a truncated frame.')
  const bytes = frame.subarray(offset, offset + length)
  const decoded = compression === 1 ? gunzipSync(bytes) : bytes
  if (compression !== 0 && compression !== 1)
    throw new Error('Doubao ASR used unsupported compression.')
  const content = decoded.toString('utf8')
  let payload: unknown = content
  try {
    payload = JSON.parse(content)
  } catch {
    // Error frames may contain plain text instead of JSON.
  }
  return {
    last: Boolean(flags & 0x02) || (sequence !== undefined && sequence < 0),
    errorCode: type === 0x0f ? sequence : undefined,
    payload,
  }
}

function resultText(payload: any): string | undefined {
  const result = payload?.payload_msg?.result ?? payload?.result
  if (typeof result?.text === 'string') return result.text
  if (Array.isArray(result))
    return result.map(item => item?.text || '').join('')
  return undefined
}

export function transcribeWithDoubaoStreaming(
  audio: Buffer,
  apiKey: string,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(ASR_URL, {
      headers: {
        'X-Api-Key': apiKey,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Request-Id': randomUUID(),
      },
      handshakeTimeout: 15_000,
    })
    let done = false
    let text = ''
    const timeout = setTimeout(
      () => finish(new Error('Doubao ASR timed out.')),
      120_000
    )
    const onAbort = () => finish(new Error('Speech request cancelled.'))
    signal.addEventListener('abort', onAbort, { once: true })

    function finish(error?: Error) {
      if (done) return
      done = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      socket.terminate()
      if (error) reject(error)
      else resolve(text)
    }

    socket.on('open', () => {
      if (signal.aborted) return onAbort()
      try {
        const config = Buffer.from(
          JSON.stringify({
            audio: {
              format: 'wav',
              codec: 'raw',
              rate: 16000,
              bits: 16,
              channel: 1,
            },
            request: {
              model_name: 'bigmodel',
              enable_itn: true,
              enable_punc: true,
            },
          })
        )
        socket.send(encodeAsrFrame(1, 0, 1, config))
        for (
          let offset = 0;
          offset < audio.length;
          offset += AUDIO_CHUNK_BYTES
        ) {
          const chunk = audio.subarray(offset, offset + AUDIO_CHUNK_BYTES)
          const last = offset + AUDIO_CHUNK_BYTES >= audio.length
          socket.send(encodeAsrFrame(2, last ? 2 : 0, 0, chunk))
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.on('message', (data: Buffer) => {
      if (done) return
      try {
        const response = decodeAsrFrame(Buffer.from(data as Buffer))
        const body = response.payload as any
        const code = Number(body?.code ?? body?.payload_msg?.code ?? 0)
        if (
          response.errorCode !== undefined ||
          (code !== 0 && code !== 20000003)
        ) {
          const message =
            body?.message ||
            body?.payload_msg?.message ||
            String(response.payload)
          throw new Error(
            `Doubao ASR ${response.errorCode ?? code}: ${message}`
          )
        }
        if (code === 20000003) return finish()
        text = resultText(body) ?? text
        if (response.last || body?.is_last_package) finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.on(
      'unexpected-response',
      (_request: unknown, response: IncomingMessage) => {
        const message = response.headers['x-api-message']
        const code = response.headers['x-api-status-code']
        const logId = response.headers['x-tt-logid']
        response.resume()
        finish(
          new Error(
            `Doubao ASR HTTP ${response.statusCode}${code ? ` code ${code}` : ''}${message ? `: ${message}` : ''}${logId ? ` (logid ${logId})` : ''}`
          )
        )
      }
    )
    socket.on('error', (error: Error) =>
      finish(new Error(`Doubao ASR connection failed: ${error.message}`))
    )
    socket.on('close', () => {
      if (!done)
        finish(
          text
            ? undefined
            : new Error('Doubao ASR closed before returning a result.')
        )
    })
    if (signal.aborted) onAbort()
  })
}
