<template>
  <div class="space-y-6">
    <section class="settings-card">
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">DATA LOCATION</span>
          <h3>数据存储位置</h3>
          <p>模型、Skills、头像、生成图片、记忆与知识库会保存在这里。</p>
        </div>
        <span class="settings-chip">{{
          formatBytes(snapshot?.dataBytes || 0)
        }}</span>
      </div>

      <div v-if="isLoading" class="storage-loading">
        <span class="loading loading-spinner loading-sm"></span>正在统计占用…
      </div>
      <template v-else-if="snapshot">
        <div class="storage-path-card">
          <span>当前数据目录</span>
          <code>{{ snapshot.dataRoot }}</code>
        </div>
        <div v-if="snapshot.pendingDataRoot" class="storage-pending">
          <strong>等待重启迁移到：</strong>
          <code>{{ snapshot.pendingDataRoot }}</code>
        </div>
        <div class="storage-actions">
          <button
            type="button"
            class="btn btn-primary"
            @click="chooseDirectory"
          >
            选择目录并迁移
          </button>
          <button type="button" class="btn btn-outline" @click="openDirectory">
            打开当前目录
          </button>
          <button
            v-if="snapshot.restartRequired"
            type="button"
            class="btn btn-outline"
            @click="restartApp"
          >
            立即重启迁移
          </button>
        </div>
        <p class="storage-note">
          迁移会在重启后、数据库打开前执行。复制成功后才切换路径并删除旧副本；失败时仍使用原目录。
        </p>
      </template>
    </section>

    <section class="settings-card">
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">CACHE</span>
          <h3>缓存与小型配置</h3>
          <p>浏览器缓存使用本机 LocalAppData；密钥与设置仍留在 Roaming。</p>
        </div>
      </div>
      <template v-if="snapshot">
        <div class="storage-grid">
          <div class="storage-path-card">
            <span>配置目录</span><code>{{ snapshot.configRoot }}</code>
          </div>
          <div class="storage-path-card">
            <span>缓存目录</span><code>{{ snapshot.cacheRoot }}</code>
          </div>
        </div>
        <div v-if="snapshot.legacyCacheBytes > 0" class="storage-cleanup">
          <div>
            <strong
              >发现旧版缓存 {{ formatBytes(snapshot.legacyCacheBytes) }}</strong
            >
            <p>这些文件位于旧 Roaming 目录，清理后会释放 C 盘空间。</p>
          </div>
          <button
            type="button"
            class="btn btn-outline"
            @click="clearLegacyCache"
          >
            清理旧缓存
          </button>
        </div>
        <p v-else class="storage-note">没有检测到需要清理的旧版缓存。</p>
      </template>
    </section>

    <section class="settings-card">
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">DIAGNOSTICS</span>
          <h3>运行日志</h3>
          <p>主进程、页面、Go 后端与未捕获异常会统一写入这里。</p>
        </div>
        <span class="settings-chip">{{
          formatBytes(snapshot?.logBytes || 0)
        }}</span>
      </div>
      <template v-if="snapshot">
        <div class="storage-path-card">
          <span>日志目录</span><code>{{ snapshot.logsRoot }}</code>
        </div>
        <div class="storage-actions">
          <button type="button" class="btn btn-outline" @click="openLogs">
            打开日志目录
          </button>
        </div>
        <p class="storage-note">
          main.log 达到 5 MB 后自动轮转，并保留一份
          main.old.log；敏感凭据会自动脱敏。
        </p>
      </template>
    </section>

    <p v-if="notice" class="storage-notice">{{ notice }}</p>
    <p v-if="error" class="settings-inline-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface StorageSnapshot {
  configRoot: string
  cacheRoot: string
  dataRoot: string
  logsRoot: string
  defaultDataRoot: string
  legacyCacheBytes: number
  dataBytes: number
  logBytes: number
  restartRequired: boolean
  pendingDataRoot?: string
}

const snapshot = ref<StorageSnapshot | null>(null)
const isLoading = ref(true)
const error = ref('')
const notice = ref('')

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function refresh(): Promise<void> {
  isLoading.value = true
  error.value = ''
  try {
    const result = await window.aliceIPC.invoke('storage:get')
    if (!result?.success) throw new Error(result?.error || '读取存储信息失败。')
    snapshot.value = result.data
  } catch (cause: any) {
    error.value = cause?.message || String(cause)
  } finally {
    isLoading.value = false
  }
}

async function chooseDirectory(): Promise<void> {
  error.value = ''
  notice.value = ''
  const result = await window.aliceIPC.invoke('storage:choose-data-root')
  if (!result?.success) {
    error.value = result?.error || '选择目录失败。'
    return
  }
  if (result.data?.canceled) return
  await refresh()
  if (result.data?.restartRequired) {
    notice.value = '新目录已保存，重启后自动迁移。'
    if (confirm('目录已选择。现在重启 Alice 并迁移数据吗？')) {
      await restartApp()
    }
  } else {
    notice.value = '当前已经使用这个目录。'
  }
}

async function openDirectory(): Promise<void> {
  const result = await window.aliceIPC.invoke('storage:open-data-root')
  if (!result?.success) error.value = result?.error || '无法打开数据目录。'
}

async function openLogs(): Promise<void> {
  const result = await window.aliceIPC.invoke('storage:open-logs-root')
  if (!result?.success) error.value = result?.error || '无法打开日志目录。'
}

async function clearLegacyCache(): Promise<void> {
  if (!confirm('确定清理旧版浏览器缓存吗？这不会删除设置、聊天或模型。')) return
  const result = await window.aliceIPC.invoke('storage:clear-legacy-cache')
  if (!result?.success) {
    error.value = result?.error || '清理缓存失败。'
    return
  }
  notice.value = `已清理 ${formatBytes(result.data?.clearedBytes || 0)} 旧缓存。`
  await refresh()
}

async function restartApp(): Promise<void> {
  await window.aliceIPC.invoke('app:restart')
}

onMounted(refresh)
</script>

<style scoped>
.storage-loading,
.storage-actions,
.storage-cleanup {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.storage-path-card,
.storage-pending {
  padding: 0.9rem 1rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.55);
}
.storage-path-card span,
.storage-path-card code,
.storage-pending code {
  display: block;
}
.storage-path-card span {
  margin-bottom: 0.35rem;
  color: #94a3b8;
  font-size: 0.78rem;
}
.storage-path-card code,
.storage-pending code {
  overflow-wrap: anywhere;
  color: #dbeafe;
}
.storage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.8rem;
}
.storage-actions {
  flex-wrap: wrap;
  margin-top: 1rem;
}
.storage-pending {
  margin-top: 0.8rem;
  border-color: rgba(59, 130, 246, 0.4);
}
.storage-cleanup {
  justify-content: space-between;
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 0.8rem;
}
.storage-cleanup p,
.storage-note {
  margin: 0.3rem 0 0;
  color: #94a3b8;
  font-size: 0.82rem;
}
.storage-note {
  margin-top: 0.8rem;
}
.storage-notice {
  color: #86efac;
}
</style>
