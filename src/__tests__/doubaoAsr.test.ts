import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeAsrFrame, encodeAsrFrame } from '../../electron/main/doubaoAsr'

describe('Doubao streaming ASR frames', () => {
  it('encodes the initial JSON request and final audio packet', () => {
    const config = encodeAsrFrame(1, 0, 1, Buffer.from('{"audio":{}}'))
    const audio = encodeAsrFrame(2, 2, 0, Buffer.from([1, 2, 3]))

    expect([...config.subarray(0, 8)]).toEqual([
      0x11, 0x10, 0x10, 0, 0, 0, 0, 12,
    ])
    expect([...audio.subarray(0, 8)]).toEqual([0x11, 0x22, 0, 0, 0, 0, 0, 3])
    expect(audio.subarray(8)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('decodes a gzipped final response with a negative sequence', () => {
    const payload = gzipSync(
      Buffer.from(JSON.stringify({ code: 0, result: { text: '你好' } }))
    )
    const frame = Buffer.alloc(12 + payload.length)
    frame.set([0x11, 0x93, 0x11, 0])
    frame.writeInt32BE(-1, 4)
    frame.writeUInt32BE(payload.length, 8)
    payload.copy(frame, 12)

    expect(decodeAsrFrame(frame)).toEqual({
      last: true,
      errorCode: undefined,
      payload: { code: 0, result: { text: '你好' } },
    })
  })

  it('rejects truncated frames', () => {
    expect(() => decodeAsrFrame(Buffer.from([0x11, 0x90, 0x10]))).toThrow()
    expect(() =>
      decodeAsrFrame(Buffer.from([0x11, 0x90, 0x10, 0, 0, 0, 0, 9]))
    ).toThrow()
  })
})
