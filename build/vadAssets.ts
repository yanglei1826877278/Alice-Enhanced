export const vadStaticCopyTargets = [
  {
    src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
    dest: './',
  },
  {
    src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
    dest: './',
  },
  {
    src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    dest: './',
  },
  {
    src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    dest: './',
  },
] as const

export const vadRuntimeAssetNames = vadStaticCopyTargets.map(target =>
  target.src.slice(target.src.lastIndexOf('/') + 1)
)
