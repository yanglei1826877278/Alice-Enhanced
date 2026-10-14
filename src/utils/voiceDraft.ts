export function composeVoiceRequest(
  transcription: string,
  draft: string
): string {
  const voiceText = transcription.trim()
  const draftText = draft.trim()
  if (!draftText) return voiceText
  return [voiceText, `输入框补充：\n${draftText}`].join('\n\n')
}

export function consumeCapturedVoiceDraft(
  currentDraft: string,
  capturedDraft: string
): string {
  if (!capturedDraft) return currentDraft
  if (currentDraft === capturedDraft) return ''
  if (currentDraft.startsWith(capturedDraft)) {
    return currentDraft.slice(capturedDraft.length).trimStart()
  }
  return currentDraft
}
