async function requestVoice(
  kind: 'stt' | 'tts',
  payload: { audio?: ArrayBuffer; text?: string },
  signal?: AbortSignal
) {
  if (!window.aliceIPC)
    throw new Error('Electron speech bridge is unavailable.')
  if (signal?.aborted)
    throw new DOMException('The operation was aborted.', 'AbortError')
  const requestId = crypto.randomUUID()
  const abort = () => {
    void window.aliceIPC.invoke('voice:cancel', requestId).catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await window.aliceIPC.invoke('voice:request', {
      requestId,
      kind,
      ...payload,
    })
    if (signal?.aborted)
      throw new DOMException('The operation was aborted.', 'AbortError')
    if (!response?.success)
      throw new Error(response?.error || 'Cloud speech request failed.')
    return response
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export async function transcribeWithCloudVoice(
  audio: ArrayBuffer
): Promise<string> {
  const response = await requestVoice('stt', { audio })
  return response.text
}

export async function synthesizeWithCloudVoice(
  text: string,
  signal: AbortSignal
): Promise<Response> {
  const response = await requestVoice('tts', { text }, signal)
  const audio = Uint8Array.from(atob(response.audio), character =>
    character.charCodeAt(0)
  )
  return new Response(audio, {
    headers: { 'Content-Type': response.mimeType || 'audio/mpeg' },
  })
}
