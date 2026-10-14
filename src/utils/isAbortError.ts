const EXPECTED_ABORT_ERROR_NAMES = new Set(['AbortError', 'APIUserAbortError'])

export function isExpectedAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const name = (error as { name?: unknown }).name
  return typeof name === 'string' && EXPECTED_ABORT_ERROR_NAMES.has(name)
}
