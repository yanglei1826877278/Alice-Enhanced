<template>
  <dialog
    ref="dialogElement"
    class="conversation-dialog window-no-drag"
    aria-labelledby="conversation-dialog-title"
    aria-describedby="conversation-dialog-message"
    @cancel.prevent="finish(null)"
    @close="handleClose"
  >
    <form @submit.prevent="submit">
      <h2 id="conversation-dialog-title">{{ options.title }}</h2>
      <p id="conversation-dialog-message">{{ options.message }}</p>
      <input
        v-if="options.inputValue !== undefined"
        ref="inputElement"
        v-model="inputValue"
        class="window-no-drag"
        aria-label="会话名称"
        maxlength="80"
      />
      <div class="conversation-dialog-actions">
        <button ref="cancelButton" type="button" @click="finish(null)">
          取消
        </button>
        <button
          type="submit"
          :class="{ danger: options.danger }"
          :disabled="options.inputValue !== undefined && !inputValue.trim()"
        >
          {{ options.confirmLabel }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

type DialogOptions = {
  title: string
  message: string
  confirmLabel: string
  inputValue?: string
  danger?: boolean
}

const dialogElement = ref<HTMLDialogElement | null>(null)
const inputElement = ref<HTMLInputElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const options = ref<DialogOptions>({ title: '', message: '', confirmLabel: '' })
const inputValue = ref('')
let resolveResult: ((result: string | boolean | null) => void) | null = null

const finish = (result: string | boolean | null) => {
  const resolve = resolveResult
  resolveResult = null
  dialogElement.value?.close()
  resolve?.(result)
}

const handleClose = () => {
  // A queued close event from the previous use must not cancel a reopened dialog.
  if (!dialogElement.value?.open) finish(null)
}

const submit = () => {
  if (options.value.inputValue !== undefined) {
    const title = inputValue.value.trim()
    if (!title) return
    finish(title)
  } else {
    finish(true)
  }
}

const open = async (dialogOptions: DialogOptions) => {
  if (resolveResult) return null
  options.value = dialogOptions
  inputValue.value = dialogOptions.inputValue || ''
  const result = new Promise<string | boolean | null>(resolve => {
    resolveResult = resolve
  })
  await nextTick()
  if (!dialogElement.value || !resolveResult) {
    finish(null)
    return result
  }
  dialogElement.value.showModal()
  if (inputElement.value) {
    inputElement.value.focus()
    inputElement.value.select()
  } else {
    cancelButton.value?.focus()
  }
  return result
}

onBeforeUnmount(() => finish(null))
defineExpose({ open })
</script>

<style scoped>
.conversation-dialog {
  width: min(360px, calc(100vw - 32px));
  margin: auto;
  padding: 20px;
  border: 1px solid rgb(75 172 226 / 68%);
  border-radius: 12px;
  background: #081f39;
  color: #e4f5ff;
  box-shadow: 0 20px 55px rgb(0 0 0 / 58%);
  -webkit-app-region: no-drag;
}

.conversation-dialog::backdrop {
  background: rgb(0 7 20 / 60%);
}

h2 {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
}

p {
  margin: 0 0 16px;
  color: #91b9d0;
  font-size: 13px;
}

input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #396e9e;
  border-radius: 6px;
  background: #031125;
  color: #e4f5ff;
}

.conversation-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

button {
  padding: 7px 14px;
  border: 1px solid #396e9e;
  border-radius: 6px;
  background: #102c52;
  color: #e4f5ff;
  cursor: pointer;
}

button[type='submit'] {
  background: #343cb1;
}

button.danger {
  background: #7f1d1d;
}

button:disabled {
  cursor: default;
  opacity: 0.4;
}

input:focus-visible,
button:focus-visible {
  outline: 2px solid #43d2f7;
  outline-offset: 2px;
}
</style>
