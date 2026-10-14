export function logFullLlmRequest(
  provider: string,
  stage: string,
  payload: unknown
): void {
  let serialized: string
  try {
    serialized = JSON.stringify(payload, null, 2)
  } catch (error) {
    serialized = `[Unable to serialize request: ${
      error instanceof Error ? error.message : String(error)
    }]`
  }

  const label = `[LLM Request][${provider}][${stage}]`
  console.groupCollapsed(`${label} ${serialized.length} characters`)
  // Log one immutable string so DevTools shows the exact payload at send time,
  // including complete image data URLs instead of a lazily evaluated object.
  console.log(`${label}\n${serialized}`)
  console.groupEnd()
}
