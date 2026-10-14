<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-xl font-semibold text-red-400">权限与安全</h3>
      <p class="mt-2 text-sm text-gray-400">
        这里的策略会直接控制文件工具、前台命令和后台进程，不再只是展示列表。
      </p>
    </div>

    <fieldset
      class="fieldset bg-gray-900/90 border-red-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">运行模式</legend>
      <div class="grid gap-3 md:grid-cols-3">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          class="rounded-xl border p-4 text-left transition"
          :class="
            snapshot?.mode === option.value
              ? 'border-cyan-400 bg-cyan-500/10'
              : 'border-gray-700 hover:border-gray-500'
          "
          :disabled="loading"
          @click="setMode(option.value)"
        >
          <span class="block font-semibold text-gray-100">{{
            option.label
          }}</span>
          <span class="mt-1 block text-xs leading-5 text-gray-400">{{
            option.description
          }}</span>
        </button>
      </div>
      <p class="mt-3 text-xs text-amber-300">
        即使选择完全访问，递归删除、强制重置、提权、凭据访问等高风险命令仍只允许单次确认。
      </p>
    </fieldset>

    <fieldset
      class="fieldset bg-gray-900/90 border-red-500/50 rounded-box w-full border p-4"
    >
      <div class="flex items-center justify-between gap-3">
        <legend class="fieldset-legend">已保存的规则</legend>
        <button
          v-if="snapshot?.sessionRules.length"
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="loading"
          @click="clearSession"
        >
          清除本次会话规则
        </button>
      </div>

      <div v-if="error" class="alert alert-error my-3 text-sm">{{ error }}</div>
      <div
        v-else-if="loading && !snapshot"
        class="py-8 text-center text-gray-400"
      >
        正在读取权限策略…
      </div>
      <div
        v-else-if="allRules.length === 0"
        class="py-8 text-center text-gray-400"
      >
        暂无规则。Alice
        第一次访问目录或执行需要确认的命令时，会让你选择授权范围。
      </div>
      <div v-else class="mt-3 overflow-x-auto">
        <table class="table table-zebra table-sm w-full">
          <thead>
            <tr>
              <th>效果</th>
              <th>能力</th>
              <th>匹配范围</th>
              <th>有效期</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in allRules" :key="rule.id">
              <td>
                <span
                  class="badge badge-sm"
                  :class="
                    rule.effect === 'allow' ? 'badge-success' : 'badge-error'
                  "
                  >{{ rule.effect === 'allow' ? '允许' : '拒绝' }}</span
                >
              </td>
              <td>{{ capabilityLabel(rule.capability) }}</td>
              <td class="max-w-md break-all font-mono text-xs">
                {{ rule.matcher }}
              </td>
              <td>{{ scopeLabel(rule.scope) }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-error btn-xs"
                  :disabled="loading"
                  @click="removeRule(rule.id)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  PermissionCapability,
  PermissionMode,
  PermissionRule,
  PermissionSnapshot,
} from '../../../types/permissions'

const snapshot = ref<PermissionSnapshot | null>(null)
const loading = ref(false)
const error = ref('')

const modeOptions: Array<{
  value: PermissionMode
  label: string
  description: string
}> = [
  {
    value: 'read-only',
    label: '只读',
    description: '允许读取文件和安全查询命令，拒绝写入及会改变状态的命令。',
  },
  {
    value: 'workspace',
    label: '工作区（推荐）',
    description: '目录首次授权后可持续读写；命令可按会话、项目或全局记住。',
  },
  {
    value: 'full-access',
    label: '完全访问',
    description: '普通文件操作和命令自动执行；高风险命令仍强制单次确认。',
  },
]

const allRules = computed<PermissionRule[]>(() => [
  ...(snapshot.value?.sessionRules || []),
  ...(snapshot.value?.persistentRules || []),
])

async function run(
  action: () => Promise<{
    success: boolean
    data?: PermissionSnapshot
    error?: string
  }>
) {
  loading.value = true
  error.value = ''
  try {
    const result = await action()
    if (!result.success || !result.data)
      throw new Error(result.error || '权限操作失败。')
    snapshot.value = result.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

function setMode(mode: PermissionMode) {
  return run(() => window.permissionsAPI.setMode(mode))
}
function removeRule(id: string) {
  return run(() => window.permissionsAPI.removeRule(id))
}
function clearSession() {
  return run(() => window.permissionsAPI.clearSession())
}
function capabilityLabel(value: PermissionCapability) {
  return value === 'command'
    ? '命令'
    : value === 'read'
      ? '读取目录'
      : '修改目录'
}
function scopeLabel(value: PermissionRule['scope']) {
  return value === 'session'
    ? '本次会话'
    : value === 'project'
      ? '当前项目'
      : '全局'
}

onMounted(() => run(() => window.permissionsAPI.get()))
</script>
