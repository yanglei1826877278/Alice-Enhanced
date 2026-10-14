<template>
  <div class="settings-window" data-theme="dark">
    <header class="settings-titlebar window-drag-area">
      <div class="settings-titlebar-brand">
        <img :src="appLogo" alt="" /><strong>Alice</strong
        ><span class="settings-titlebar-divider"></span><span>设置</span>
      </div>
      <button
        type="button"
        class="settings-window-close window-no-drag"
        aria-label="关闭设置窗口"
        @click="closeWindow"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </header>
    <Settings />
  </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import Settings from './Settings.vue'
import { appLogo } from '../utils/assetsImport'

async function closeWindow() {
  await window.aliceIPC?.invoke('settings-window:close')
}
function handleWindowKeys(event: KeyboardEvent) {
  if (
    (event.altKey && event.key === 'F4') ||
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w')
  ) {
    event.preventDefault()
    void closeWindow()
  }
}
onMounted(() => document.addEventListener('keydown', handleWindowKeys))
onUnmounted(() => document.removeEventListener('keydown', handleWindowKeys))
</script>
