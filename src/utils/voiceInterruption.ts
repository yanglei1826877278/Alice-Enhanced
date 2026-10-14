export function isExplicitVoiceStopRequest(text: string): boolean {
  return /^(停一下|停止|取消|别改了|先别改|先听我说)[。！!，,\s]*$/i.test(
    text.trim()
  )
}
