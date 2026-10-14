<template>
  <fieldset
    class="fieldset bg-gray-900/90 border-green-500/50 rounded-box w-full border p-4"
  >
    <legend class="fieldset-legend">Agent Skills</legend>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="text-sm text-gray-300 max-w-2xl">
        <p>
          Install a folder containing SKILL.md. User skills are scanned from
          <code>~/.agents/skills</code> only when requested, and installed
          skills are stored in
          <code>{{ snapshot.installRoot || 'user-customization/skills' }}</code
          >.
        </p>
        <p class="mt-2">
          Use <code>$skill-name</code> at the start of a message to invoke a
          skill directly. Alice can also choose enabled skills when their
          descriptions match your request.
        </p>
      </div>
      <div class="flex gap-2">
        <button
          class="btn btn-sm btn-outline"
          type="button"
          :disabled="busy"
          @click="scanUserSkills"
        >
          Scan user skills
        </button>
        <button
          class="btn btn-sm btn-outline"
          type="button"
          :disabled="busy"
          @click="refresh"
        >
          Refresh
        </button>
        <button
          class="btn btn-sm btn-primary"
          type="button"
          :disabled="busy"
          @click="importFolder"
        >
          Import folder
        </button>
      </div>
    </div>
    <p v-if="error" class="text-error text-sm mt-3" role="alert">{{ error }}</p>
    <ul
      v-if="snapshot.diagnostics.length"
      class="text-warning text-xs mt-3 list-disc pl-5"
    >
      <li v-for="item in snapshot.diagnostics" :key="item">{{ item }}</li>
    </ul>
    <p v-if="!snapshot.skills.length" class="text-sm text-gray-400 mt-4">
      No skills found.
    </p>
    <div v-else class="space-y-3 mt-4">
      <div
        v-for="skill in snapshot.skills"
        :key="skill.directory"
        class="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-white">{{ skill.name }}</strong>
              <span
                class="badge badge-xs"
                :class="
                  skill.source === 'alice' ? 'badge-primary' : 'badge-ghost'
                "
                >{{ skill.source }}</span
              >
              <span v-if="skill.manualOnly" class="badge badge-xs badge-outline"
                >manual only</span
              >
              <span v-if="!skill.isValid" class="badge badge-xs badge-error"
                >invalid</span
              >
            </div>
            <p class="text-sm text-gray-300 mt-1">{{ skill.description }}</p>
            <p class="text-xs text-gray-500 mt-1 break-all">
              {{ skill.directory }}
            </p>
            <ul
              v-if="skill.errors.length"
              class="text-xs text-error mt-2 list-disc pl-5"
            >
              <li v-for="item in skill.errors" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <label class="label cursor-pointer gap-2"
              ><span class="text-xs">Enabled</span
              ><input
                type="checkbox"
                class="toggle toggle-success toggle-sm"
                :checked="skill.enabled"
                :disabled="busy || !skill.isValid"
                @change="toggle(skill.name, !skill.enabled)"
            /></label>
            <button
              v-if="skill.source === 'alice'"
              type="button"
              class="btn btn-xs btn-ghost"
              :disabled="busy"
              @click="remove(skill.name)"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { SkillsSnapshot } from '../../../types/skills'

const snapshot = ref<SkillsSnapshot>({
  skills: [],
  installRoot: '',
  diagnostics: [],
})
const busy = ref(false)
const error = ref('')

async function refresh() {
  if (!window.skillsAPI) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.skillsAPI.list()
    if (!result.success || !result.data)
      throw new Error(result.error || 'Could not load skills.')
    snapshot.value = result.data
  } catch (cause: any) {
    error.value = cause?.message || String(cause)
  } finally {
    busy.value = false
  }
}

async function importFolder() {
  if (!window.skillsAPI) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.skillsAPI.importFolder()
    if (!result.success)
      throw new Error(result.error || 'Could not import skill.')
    if (result.data) snapshot.value = result.data
  } catch (cause: any) {
    error.value = cause?.message || String(cause)
  } finally {
    busy.value = false
  }
}

async function scanUserSkills() {
  if (!window.skillsAPI) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.skillsAPI.scanUser()
    if (!result.success || !result.data)
      throw new Error(result.error || 'Could not scan user skills.')
    snapshot.value = result.data
  } catch (cause: any) {
    error.value = cause?.message || String(cause)
  } finally {
    busy.value = false
  }
}

async function toggle(name: string, enabled: boolean) {
  if (!window.skillsAPI) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.skillsAPI.toggle(name, enabled)
    if (!result.success || !result.data)
      throw new Error(result.error || 'Could not update skill.')
    snapshot.value = result.data
  } catch (cause: any) {
    error.value = cause?.message || String(cause)
  } finally {
    busy.value = false
  }
}

async function remove(name: string) {
  if (!window.skillsAPI || !confirm(`Remove installed skill ${name}?`)) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.skillsAPI.remove(name)
    if (!result.success || !result.data)
      throw new Error(result.error || 'Could not remove skill.')
    snapshot.value = result.data
  } catch (cause: any) {
    error.value = cause?.message || String(cause)
  } finally {
    busy.value = false
  }
}

const onUpdated = () => {
  void refresh()
}
onMounted(() => {
  void refresh()
  window.aliceIPC?.on('skills:updated', onUpdated)
})
onUnmounted(() => window.aliceIPC?.off('skills:updated', onUpdated))
</script>
