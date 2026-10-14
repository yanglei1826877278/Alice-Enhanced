import type { RealTimeVADOptions } from '@ricky0123/vad-web'

type VadCallbacks = Pick<RealTimeVADOptions, 'onSpeechStart' | 'onSpeechEnd'>

function resolveAssetPath(assetPath: string): string {
  if (typeof window === 'undefined') {
    return assetPath
  }

  return new URL(assetPath, window.location.href).href
}

export function createVadOptions(
  assetPath: string,
  callbacks: VadCallbacks
): Partial<RealTimeVADOptions> {
  const resolvedAssetPath = resolveAssetPath(assetPath)

  return {
    ...callbacks,
    baseAssetPath: resolvedAssetPath,
    onnxWASMBasePath: resolvedAssetPath,
    model: 'legacy',
    startOnLoad: false,
    ortConfig: ort => {
      ort.env.logLevel = 'error'
      ort.env.wasm.wasmPaths = {
        wasm: `${resolvedAssetPath}ort-wasm-simd-threaded.wasm`,
        mjs: `${resolvedAssetPath}ort-wasm-simd-threaded.mjs`,
      }
    },
  }
}
