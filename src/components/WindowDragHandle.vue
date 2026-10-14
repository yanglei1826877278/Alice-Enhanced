<template>
  <div
    class="sidebar-drag-handle window-no-drag"
    title="Drag to move Alice"
    aria-label="Drag to move Alice"
    @pointerdown="start"
    @pointerup="stop"
    @pointercancel="stop"
    @lostpointercapture="stop"
  >
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="7" cy="7" r="1.25" />
      <circle cx="12" cy="7" r="1.25" />
      <circle cx="17" cy="7" r="1.25" />
      <circle cx="7" cy="12" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="17" cy="12" r="1.25" />
    </svg>
    <span>拖动窗口</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

let capture: { element: HTMLElement; pointerId: number } | null = null

function stop() {
  if (!capture) return
  const { element, pointerId } = capture
  capture = null
  window.aliceIPC?.send('window:drag-end')
  if (element.hasPointerCapture(pointerId))
    element.releasePointerCapture(pointerId)
}

function start(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || !window.aliceIPC) return
  stop()
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  capture = { element, pointerId: event.pointerId }
  event.preventDefault()
  window.aliceIPC.send('window:drag-start')
}

onBeforeUnmount(stop)
</script>
