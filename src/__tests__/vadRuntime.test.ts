import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  vadRuntimeAssetNames,
  vadStaticCopyTargets,
} from '../../build/vadAssets'
import { createVadOptions } from '../composables/vadRuntime'

describe('VAD runtime packaging', () => {
  it('ships every configured local runtime asset', () => {
    for (const target of vadStaticCopyTargets) {
      expect(fs.existsSync(path.resolve(target.src)), target.src).toBe(true)
    }

    expect(vadRuntimeAssetNames).toEqual(
      expect.arrayContaining([
        'vad.worklet.bundle.min.js',
        'silero_vad_legacy.onnx',
        'ort-wasm-simd-threaded.mjs',
        'ort-wasm-simd-threaded.wasm',
      ])
    )
    expect(vadRuntimeAssetNames).not.toContain('silero_vad_v5.onnx')
  })
})

describe('VAD initialization options', () => {
  it('resolves relative assets from the renderer URL', () => {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:3344/' },
    })

    const options = createVadOptions('./', {
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
    })

    expect(options.baseAssetPath).toBe('http://localhost:3344/')
    expect(options.onnxWASMBasePath).toBe('http://localhost:3344/')

    vi.unstubAllGlobals()
  })

  it('uses local assets and leaves startup under application control', () => {
    const onSpeechStart = vi.fn()
    const onSpeechEnd = vi.fn()

    const options = createVadOptions('file:///app/dist/', {
      onSpeechStart,
      onSpeechEnd,
    })

    expect(options).toMatchObject({
      baseAssetPath: 'file:///app/dist/',
      onnxWASMBasePath: 'file:///app/dist/',
      model: 'legacy',
      startOnLoad: false,
      onSpeechStart,
      onSpeechEnd,
    })

    const ort = { env: { logLevel: 'warning', wasm: {} } }
    options.ortConfig?.(ort as never)

    expect(ort).toMatchObject({
      env: {
        logLevel: 'error',
        wasm: {
          wasmPaths: {
            wasm: 'file:///app/dist/ort-wasm-simd-threaded.wasm',
            mjs: 'file:///app/dist/ort-wasm-simd-threaded.mjs',
          },
        },
      },
    })
  })
})
