<template>
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.core" />
  </svg>
</template>
<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  core: 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  assistant:
    'M9 3h6M12 3v3M5 7h14v13H5V7ZM8 11h.01M16 11h.01M9 16h6M2 11v5M22 11v5',
  voice:
    'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  customization:
    'M12 3a9 9 0 1 0 9 9M16 3h5v5M21 3l-7 7M8 15c2 2 6 2 8 0M8 9h.01',
  knowledge:
    'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4ZM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2',
  memories: 'M5 5h14v14H5V5ZM8 9h8M8 13h6M8 17h4M3 3h.01M21 21h.01',
  tools: 'm14 5 5 5M9 10 3 16v5h5l6-6M14 5l2-2 5 5-2 2M9 10l5 5',
  hotkeys: 'M3 6h18v12H3V6ZM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  integrations: 'M8 3v4M16 3v4M6 7h12v5a6 6 0 0 1-12 0V7ZM12 18v4',
  storage:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  security: 'm12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4ZM8 12l3 3 5-5',
}
</script>
