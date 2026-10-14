<template>
  <div class="space-y-6">
    <section v-if="section === 'core'" class="settings-card">
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">CONNECTION</span>
          <h3>模型服务</h3>
          <p>使用现有服务商，或连接兼容 OpenAI 格式的 API。</p>
        </div>
        <span class="settings-chip">{{ providerConnection.name }}</span>
      </div>
      <div class="settings-field-grid">
        <label class="settings-field"
          ><span>服务商</span
          ><select v-model="currentSettings.aiProvider" class="select w-full">
            <option value="custom">自定义 · OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="zai">Z.ai</option>
            <option value="minimax">MiniMax</option>
            <option value="deepseek">DeepSeek</option>
            <option value="api-route">API Route</option>
            <option value="codex">ChatGPT Codex</option>
            <option value="ollama">Ollama · 本地</option>
            <option value="lm-studio">LM Studio · 本地</option>
          </select></label
        >
        <label v-if="providerConnection.keyField" class="settings-field"
          ><span>API Key</span
          ><input
            v-model="currentSettings[providerConnection.keyField]"
            type="password"
            autocomplete="new-password"
            class="input w-full"
            placeholder="输入此服务商的 API Key"
        /></label>
        <label
          v-if="providerConnection.urlField"
          class="settings-field settings-field-wide"
          ><span>Base URL</span
          ><input
            v-model="currentSettings[providerConnection.urlField]"
            type="url"
            class="input w-full"
            :placeholder="providerConnection.placeholder"
          /><small
            >填写 API 基础地址，不要包含 /chat/completions。</small
          ></label
        >
      </div>
      <div
        v-if="currentSettings.aiProvider === 'codex'"
        class="settings-account-card"
      >
        <span>{{
          codexAuthStatus.isAuthenticated
            ? codexAuthStatus.accountLabel || '已连接'
            : '尚未连接 ChatGPT 账号'
        }}</span>
        <div class="flex gap-2">
          <button
            v-if="!codexAuthStatus.isAuthenticated"
            type="button"
            class="btn btn-primary"
            :disabled="
              codexAuthStatus.isLoading || codexAuthStatus.authInProgress
            "
            @click="startCodexAuth"
          >
            连接 ChatGPT</button
          ><button
            v-else
            type="button"
            class="btn btn-outline"
            @click="disconnectCodex"
          >
            断开连接</button
          ><button
            type="button"
            class="btn btn-outline"
            @click="checkCodexAuthStatus"
          >
            刷新状态
          </button>
        </div>
        <p v-if="codexAuthStatus.error" class="settings-inline-error">
          {{ codexAuthStatus.error }}
        </p>
      </div>
    </section>
    <section v-if="section === 'core'" class="settings-card">
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">MODELS</span>
          <h3>对话与总结模型</h3>
          <p>可以直接填写服务商提供的模型 ID。</p>
        </div>
      </div>
      <datalist id="settings-connection-models">
        <option
          v-for="model in modelSuggestions"
          :key="model.id"
          :value="model.id"
        />
      </datalist>
      <div class="settings-field-grid">
        <label class="settings-field"
          ><span>对话模型</span
          ><input
            v-model="currentSettings.assistantModel"
            list="settings-connection-models"
            class="input w-full"
            placeholder="输入或选择模型 ID" /></label
        ><label class="settings-field"
          ><span>总结模型</span
          ><input
            v-model="currentSettings.SUMMARIZATION_MODEL"
            list="settings-connection-models"
            class="input w-full"
            placeholder="可与对话模型相同"
        /></label>
      </div>
    </section>
    <section v-if="section === 'voice'" class="settings-card">
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">VOICE SERVICES</span>
          <h3>听你说，也说给你听</h3>
          <p>语音服务与聊天模型独立，识别和合成可以混用不同服务商。</p>
        </div>
      </div>
      <div class="settings-field-grid">
        <label class="settings-field"
          ><span>语音识别</span
          ><select v-model="currentSettings.sttProvider" class="select w-full">
            <option value="doubao">豆包语音</option>
            <option value="tencent">腾讯云语音</option>
            <option value="custom">自定义兼容接口</option>
            <option value="openai">OpenAI</option>
            <option value="groq">Groq</option>
            <option value="google">Google Cloud</option>
            <option value="local">本地 Whisper</option>
          </select></label
        >
        <label class="settings-field"
          ><span>语音合成</span
          ><select v-model="currentSettings.ttsProvider" class="select w-full">
            <option value="doubao">豆包语音</option>
            <option value="tencent">腾讯云语音</option>
            <option value="custom">自定义兼容接口</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google Cloud</option>
            <option value="local">本地 Piper</option>
          </select></label
        >
        <label
          v-if="
            currentSettings.sttProvider === 'openai' ||
            currentSettings.ttsProvider === 'openai'
          "
          class="settings-field settings-field-wide"
          ><span>OpenAI API Key</span
          ><input
            v-model="currentSettings.VITE_OPENAI_API_KEY"
            type="password"
            autocomplete="new-password"
            class="input w-full"
            placeholder="sk-..."
        /></label>
        <label
          v-if="currentSettings.sttProvider === 'groq'"
          class="settings-field settings-field-wide"
          ><span>Groq API Key</span
          ><input
            v-model="currentSettings.VITE_GROQ_API_KEY"
            type="password"
            autocomplete="new-password"
            class="input w-full"
            placeholder="gsk_..."
        /></label>
        <label
          v-if="
            currentSettings.sttProvider === 'google' ||
            currentSettings.ttsProvider === 'google'
          "
          class="settings-field settings-field-wide"
          ><span>Google Cloud API Key</span
          ><input
            v-model="currentSettings.VITE_GOOGLE_API_KEY"
            type="password"
            autocomplete="new-password"
            class="input w-full"
            placeholder="AIza..."
        /></label>
        <label
          v-if="
            currentSettings.sttProvider === 'google' ||
            currentSettings.sttProvider === 'local'
          "
          class="settings-field"
          ><span>识别语言</span
          ><select
            v-model="currentSettings.localSttLanguage"
            class="select w-full"
          >
            <option value="auto">自动识别 · Google 默认英文</option>
            <option
              v-for="language in recognitionLanguages"
              :key="language.code"
              :value="language.code"
            >
              {{ language.label }}
            </option>
          </select></label
        >
      </div>
    </section>
    <section
      v-if="
        section === 'voice' &&
        (['doubao', 'tencent', 'custom'].includes(
          currentSettings.sttProvider
        ) ||
          ['doubao', 'tencent', 'custom'].includes(currentSettings.ttsProvider))
      "
      class="settings-card"
    >
      <div class="settings-card-heading">
        <div>
          <span class="settings-eyebrow">CREDENTIALS</span>
          <h3>服务凭证与音色</h3>
        </div>
      </div>
      <CloudVoiceProviderFields :settings="currentSettings" />
    </section>
    <!-- Local STT Configuration Section -->
    <fieldset
      v-if="section === 'voice' && currentSettings.sttProvider === 'local'"
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">
        Local Speech-to-Text Configuration (Go Backend)
        <span
          class="w-2 h-2 rounded-full inline-block"
          :class="getServiceStatusClass('stt')"
          :title="getServiceStatusText('stt')"
        ></span>
      </legend>
      <div class="space-y-4 p-2">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="stt-model" class="block mb-1 text-sm"
              >Whisper Model *</label
            >
            <select
              id="stt-model"
              v-model="currentSettings.localSttModel"
              class="select select-bordered w-full focus:select-primary"
              @change="
                e => $emit('update:setting', 'localSttModel', getTargetValue(e))
              "
            >
              <option value="whisper-tiny.en">
                Tiny (English only, fastest)
              </option>
              <option value="whisper-base">Base (multilingual)</option>
              <option value="whisper-small">Small (better accuracy)</option>
              <option value="whisper-medium">Medium (high accuracy)</option>
              <option value="whisper-large">Large (best accuracy)</option>
            </select>
            <p class="text-xs text-gray-400 mt-1">
              Larger models provide better accuracy but require more resources.
            </p>
          </div>
          <div>
            <label for="stt-wake-enable" class="block mb-1 text-sm"
              >Enable Wake Word</label
            >
            <select
              id="stt-wake-enable"
              v-model="currentSettings.localSttEnabled"
              class="select select-bordered w-full focus:select-primary"
              @change="
                e =>
                  $emit(
                    'update:setting',
                    'localSttEnabled',
                    getTargetValue(e) === 'true'
                  )
              "
            >
              <option :value="true">Enable</option>
              <option :value="false">Disable</option>
            </select>
          </div>
          <div v-show="currentSettings.localSttEnabled">
            <label for="stt-wakeword" class="block mb-1 text-sm"
              >Wake Word *</label
            >
            <input
              id="stt-wakeword"
              type="text"
              v-model="currentSettings.localSttWakeWord"
              class="input input-bordered w-full focus:input-primary"
              @change="
                e =>
                  $emit('update:setting', 'localSttWakeWord', getTargetValue(e))
              "
              placeholder="alice"
            />
            <p class="text-xs text-gray-400 mt-1">
              The word that will activate voice recording. Use simple, common
              words for better recognition.
            </p>
          </div>
        </div>
      </div>
    </fieldset>

    <!-- TTS Settings Section -->
    <fieldset
      v-if="
        section === 'voice' &&
        ['openai', 'google', 'local'].includes(currentSettings.ttsProvider)
      "
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">
        Text-to-Speech Configuration
        <span
          class="w-2 h-2 rounded-full inline-block"
          :class="getServiceStatusClass('tts')"
          :title="getServiceStatusText('tts')"
        ></span>
      </legend>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-2">
        <div v-if="currentSettings.ttsProvider === 'openai'">
          <label for="tts-voice" class="block mb-1 text-sm"
            >OpenAI TTS Voice</label
          >
          <select
            id="tts-voice"
            v-model="currentSettings.ttsVoice"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="alloy">Alloy</option>
            <option value="ash">Ash</option>
            <option value="ballad">Ballad</option>
            <option value="coral">Coral</option>
            <option value="echo">Echo</option>
            <option value="fable">Fable</option>
            <option value="nova">Nova</option>
            <option value="onyx">Onyx</option>
            <option value="sage">Sage</option>
            <option value="shimmer">Shimmer</option>
            <option value="verse">Verse</option>
            <option value="marin">Marin (Recommended)</option>
            <option value="cedar">Cedar (Recommended)</option>
          </select>
        </div>
        <div v-if="currentSettings.ttsProvider === 'google'">
          <label for="google-tts-voice" class="block mb-1 text-sm"
            >Google TTS Voice</label
          >
          <select
            id="google-tts-voice"
            v-model="currentSettings.googleTtsVoice"
            class="select select-bordered w-full focus:select-primary"
            @change="
              e => $emit('update:setting', 'googleTtsVoice', getTargetValue(e))
            "
          >
            <option value="en-US-Journey-F">Journey F (Fem)</option>
            <option value="en-US-Journey-O">Journey O (Fem)</option>
            <option value="en-US-Neural2-C">Neural2 C (Fem)</option>
            <option value="en-US-Neural2-F">Neural2 F (Fem)</option>
            <option value="en-US-Neural2-H">Neural2 H (Fem)</option>
            <option value="en-US-Standard-C">Standard C (Fem)</option>
            <option value="en-US-Standard-E">Standard E (Fem)</option>
            <option value="en-US-Wavenet-C">Wavenet C (Fem)</option>
            <option value="en-US-Wavenet-F">Wavenet F (Fem)</option>
          </select>
        </div>
        <div v-if="currentSettings.ttsProvider === 'local'">
          <label for="local-tts-voice" class="block mb-1 text-sm"
            >Local TTS Voice</label
          >
          <div class="space-y-3">
            <div class="flex gap-2 items-center">
              <select
                id="local-tts-voice"
                v-model="currentSettings.localTtsVoice"
                class="select select-bordered flex-1 focus:select-primary"
              >
                <option v-if="availableVoices.length === 0" disabled value="">
                  {{
                    isRefreshingVoices
                      ? 'Loading voices...'
                      : 'No voices available'
                  }}
                </option>
                <optgroup
                  v-for="(voices, language) in groupedVoices"
                  :key="language"
                  :label="getLanguageDisplayName(language)"
                >
                  <option
                    v-for="voice in voices"
                    :key="voice.name"
                    :value="voice.name"
                    :title="`${voice.description} | Quality: ${getVoiceQuality(voice.name)} | Gender: ${voice.gender || 'Unknown'}`"
                  >
                    {{ getVoiceDisplayName(voice) }}
                  </option>
                </optgroup>
              </select>
              <button
                type="button"
                @click="refreshVoices"
                :disabled="isRefreshingVoices"
                class="btn btn-square btn-sm"
                title="Refresh voices"
              >
                <span
                  v-if="isRefreshingVoices"
                  class="loading loading-spinner loading-xs"
                ></span>
                <span v-else>🔄</span>
              </button>
              <button
                type="button"
                @click="previewVoice"
                :disabled="!currentSettings.localTtsVoice || isPreviewingVoice"
                class="btn btn-square btn-sm"
                title="Preview selected voice"
              >
                <span
                  v-if="isPreviewingVoice"
                  class="loading loading-spinner loading-xs"
                ></span>
                <span v-else>🎵</span>
              </button>
            </div>

            <div
              class="flex items-center justify-between text-xs text-gray-400"
            >
              <span>
                {{ availableVoices.filter(v => v.gender !== 'male').length }}
                voice{{
                  availableVoices.filter(v => v.gender !== 'male').length !== 1
                    ? 's'
                    : ''
                }}
                across {{ Object.keys(groupedVoices).length }} languages
              </span>
              <span
                class="text-blue-400 cursor-pointer hover:underline"
                @click="showVoiceHelp = !showVoiceHelp"
              >
                {{ showVoiceHelp ? 'Hide Help' : 'Voice Help' }}
              </span>
            </div>

            <!-- Voice Help Section -->
            <div
              v-if="showVoiceHelp"
              class="bg-base-300 p-3 rounded-lg text-xs space-y-2"
            >
              <h5 class="font-medium text-sm">Voice Quality Levels:</h5>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="badge badge-xs badge-outline mr-1">x_low</span>
                  16kHz, Smallest
                </div>
                <div>
                  <span class="badge badge-xs badge-outline mr-1">low</span>
                  16kHz, Fast
                </div>
                <div>
                  <span class="badge badge-xs badge-outline mr-1">medium</span>
                  22kHz, High Quality
                </div>
                <div>
                  <span class="badge badge-xs badge-outline mr-1">high</span>
                  22kHz, Best Quality
                </div>
              </div>
              <p class="text-base-content/60 mt-2">
                💡 <strong>Tip:</strong> Voice models are downloaded
                automatically when first used. Higher quality voices provide
                better audio but require more storage space.
              </p>
            </div>
          </div>
        </div>
      </div>
    </fieldset>

    <!-- Embedding Configuration Section -->
    <fieldset
      v-if="section === 'knowledge'"
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">
        Embedding Configuration
        <span
          class="w-2 h-2 rounded-full inline-block"
          :class="getServiceStatusClass('embeddings')"
          :title="getServiceStatusText('embeddings')"
        ></span>
      </legend>
      <div class="grid grid-cols-1 gap-4 p-2">
        <div>
          <label for="memory-mode" class="block mb-1 text-sm">新会话默认类型</label>
          <select
            id="memory-mode"
            v-model="currentSettings.memoryMode"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="temporary">临时对话 · 不保存、不召回</option>
            <option value="session">普通会话 · 仅当前会话</option>
            <option value="long-term">长期记忆 · 允许跨会话召回</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            点击聊天窗口的 NEW 时仍可单独选择；已有会话会保留自己的类型。
          </p>
        </div>
        <div>
          <label for="embedding-provider" class="block mb-1 text-sm"
            >Embedding Provider (optional)</label
          >
          <select
            id="embedding-provider"
            v-model="currentSettings.embeddingProvider"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="openai">OpenAI (Cloud)</option>
            <option value="aliyun">Alibaba Cloud Model Studio</option>
            <option value="local">Local (multi-lang E5)</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            Memory search uses embeddings to find relevant past messages. If the
            selected service is unavailable, chat continues without memory search.
          </p>
        </div>
        <template v-if="currentSettings.embeddingProvider === 'aliyun'">
          <label class="settings-field">
            <span>Model Studio API Key</span>
            <input
              v-model="currentSettings.VITE_ALIYUN_API_KEY"
              type="password"
              autocomplete="new-password"
              class="input w-full"
              placeholder="sk-..."
            />
          </label>
          <label class="settings-field">
            <span>Model Studio Base URL</span>
            <input
              v-model.trim="currentSettings.aliyunEmbeddingBaseUrl"
              type="url"
              class="input w-full"
              placeholder="https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
            />
          </label>
          <label class="settings-field">
            <span>Embedding Model</span>
            <select
              v-model="currentSettings.aliyunEmbeddingModel"
              class="select select-bordered w-full focus:select-primary"
            >
              <option value="qwen3.7-text-embedding">
                qwen3.7-text-embedding (recommended)
              </option>
              <option value="qwen3.7-text-embedding-flash">
                qwen3.7-text-embedding-flash (lowest cost)
              </option>
              <option value="text-embedding-v4">text-embedding-v4</option>
              <option value="text-embedding-v3">text-embedding-v3</option>
            </select>
            <small>Uses a separate 1024-dimensional index.</small>
          </label>
        </template>
        <div v-if="currentSettings.embeddingProvider !== 'local'">
          <label for="image-memory-enabled" class="block mb-1 text-sm"
            >Image Memory</label
          >
          <select
            id="image-memory-enabled"
            v-model="currentSettings.imageMemoryEnabled"
            class="select select-bordered w-full focus:select-primary"
          >
            <option :value="true">Enabled</option>
            <option :value="false">Disabled</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            Creates a short searchable description and OCR summary for images before
            storing the message embedding.
          </p>
        </div>
        <div
          v-if="
            currentSettings.embeddingProvider !== 'local' &&
            currentSettings.imageMemoryEnabled
          "
        >
          <label for="image-memory-model" class="block mb-1 text-sm"
            >Image Memory Vision Model</label
          >
          <input
            id="image-memory-model"
            v-model.trim="currentSettings.imageMemoryModel"
            type="text"
            class="input input-bordered w-full focus:input-primary"
            placeholder="gpt-4o-mini"
            list="image-memory-model-suggestions"
          />
          <datalist id="image-memory-model-suggestions">
            <option value="gpt-4o-mini"></option>
            <option value="gpt-6-luna"></option>
            <option value="gpt-4.1-mini"></option>
          </datalist>
          <p class="text-xs text-gray-400 mt-1">
            Uses OpenAI with low image detail and a short output to control cost.
            This is separate from the main assistant model.
          </p>
          <label class="settings-field mt-3">
            <span>Vision Base URL</span>
            <input
              v-model.trim="currentSettings.imageMemoryBaseUrl"
              type="url"
              class="input w-full"
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label class="settings-field mt-3">
            <span>Vision API Key</span>
            <input
              v-model="currentSettings.VITE_IMAGE_MEMORY_API_KEY"
              type="password"
              autocomplete="new-password"
              class="input w-full"
              placeholder="Empty means use OpenAI API Key"
            />
          </label>
        </div>
      </div>
    </fieldset>

    <section
      v-if="
        section === 'knowledge' &&
        currentSettings.embeddingProvider === 'openai'
      "
      class="settings-card"
    >
      <label class="settings-field"
        ><span>OpenAI Embedding API Key</span
        ><input
          v-model="currentSettings.VITE_OPENAI_API_KEY"
          type="password"
          autocomplete="new-password"
          class="input w-full"
          placeholder="sk-..."
      /></label>
    </section>
    <!-- Local Documents (RAG) Section -->
    <fieldset
      v-if="section === 'knowledge'"
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">Local Documents (RAG)</legend>
      <div class="grid grid-cols-1 gap-4 p-2">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label for="rag-enabled" class="block mb-1 text-sm"
              >Enable RAG</label
            >
            <select
              id="rag-enabled"
              v-model="currentSettings.ragEnabled"
              class="select select-bordered w-full focus:select-primary"
            >
              <option :value="true">Enabled</option>
              <option :value="false">Disabled</option>
            </select>
          </div>
          <div>
            <label for="rag-topk" class="block mb-1 text-sm"
              >Top K Chunks</label
            >
            <input
              id="rag-topk"
              type="number"
              min="1"
              max="20"
              v-model.number="currentSettings.ragTopK"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
          <div>
            <label for="rag-max-chars" class="block mb-1 text-sm"
              >Max Context Chars</label
            >
            <input
              id="rag-max-chars"
              type="number"
              min="500"
              max="6000"
              step="100"
              v-model.number="currentSettings.ragMaxContextChars"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="isIndexingRag"
            @click="selectRagPaths"
          >
            Add Files/Folders
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :disabled="isIndexingRag || currentSettings.ragPaths.length === 0"
            @click="reindexRag"
          >
            Reindex
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            :disabled="isIndexingRag"
            @click="clearRagIndex"
          >
            Clear Index
          </button>
          <span class="text-xs text-gray-400">
            {{ ragStats.documents }} docs, {{ ragStats.chunks }} chunks
          </span>
          <span v-if="ragStatusMessage" class="text-xs text-gray-400">
            {{ ragStatusMessage }}
          </span>
        </div>

        <div v-if="currentSettings.ragPaths.length > 0">
          <label class="block mb-2 text-sm">Indexed Paths</label>
          <div class="space-y-2">
            <div
              v-for="pathItem in currentSettings.ragPaths"
              :key="pathItem"
              class="flex items-center justify-between gap-2 bg-gray-800/50 rounded px-3 py-2 text-xs"
            >
              <span class="truncate" :title="pathItem">{{ pathItem }}</span>
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                @click="removeRagPath(pathItem)"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { AliceSettings } from '../../stores/settingsStore'
import CloudVoiceProviderFields from './CloudVoiceProviderFields.vue'
import { getStaticModelsForProvider } from '../../services/llmProviders/providerCatalog'
import { backendApi, type Voice } from '../../services/backendApi'
import { useCodexAuth } from '../../composables/useCodexAuth'

// Type for service status
interface ServiceStatus {
  status: 'ready' | 'downloading' | 'error' | 'offline'
}

const props = defineProps<{
  currentSettings: AliceSettings
  section: 'core' | 'voice' | 'knowledge'
  availableModels?: { id: string }[]
}>()

const emit = defineEmits<{
  'update:setting': [
    key: keyof AliceSettings,
    value: string | boolean | number | string[],
  ]
}>()

interface ProviderConnection {
  name: string
  keyField?: keyof AliceSettings
  urlField?: keyof AliceSettings
  placeholder?: string
}
const providerConnections: Record<string, ProviderConnection> = {
  openai: { name: 'OpenAI', keyField: 'VITE_OPENAI_API_KEY' },
  openrouter: { name: 'OpenRouter', keyField: 'VITE_OPENROUTER_API_KEY' },
  zai: {
    name: 'Z.ai',
    keyField: 'VITE_ZAI_API_KEY',
    urlField: 'zaiBaseUrl',
    placeholder: 'https://api.z.ai/api/coding/paas/v4',
  },
  minimax: {
    name: 'MiniMax',
    keyField: 'VITE_MINIMAX_API_KEY',
    urlField: 'minimaxBaseUrl',
    placeholder: 'https://api.minimax.io/v1',
  },
  deepseek: {
    name: 'DeepSeek',
    keyField: 'VITE_DEEPSEEK_API_KEY',
    urlField: 'deepseekBaseUrl',
    placeholder: 'https://api.deepseek.com',
  },
  'api-route': { name: 'API Route', keyField: 'VITE_API_ROUTE_API_KEY' },
  custom: {
    name: 'Custom API',
    keyField: 'VITE_CUSTOM_API_KEY',
    urlField: 'customBaseUrl',
    placeholder: 'https://example.com/v1',
  },
  codex: { name: 'ChatGPT Codex' },
  ollama: {
    name: 'Ollama',
    urlField: 'ollamaBaseUrl',
    placeholder: 'http://localhost:11434',
  },
  'lm-studio': {
    name: 'LM Studio',
    urlField: 'lmStudioBaseUrl',
    placeholder: 'http://localhost:1234',
  },
}
const providerConnection = computed(
  () =>
    providerConnections[props.currentSettings.aiProvider] ||
    providerConnections.custom
)
const modelSuggestions = computed(() => {
  const models = [
    ...getStaticModelsForProvider(props.currentSettings.aiProvider),
    ...(props.availableModels || []),
  ]
  return models.filter(
    (model, index) => models.findIndex(other => other.id === model.id) === index
  )
})
const recognitionLanguages = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'pl', label: 'Polski' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'sv', label: 'Svenska' },
  { code: 'da', label: 'Dansk' },
  { code: 'no', label: 'Norsk' },
  { code: 'fi', label: 'Suomi' },
]

const serviceStatus = ref<{
  stt: ServiceStatus
  tts: ServiceStatus
  embeddings: ServiceStatus
}>({
  stt: { status: 'offline' },
  tts: { status: 'offline' },
  embeddings: { status: 'offline' },
})

const availableVoices = ref<Voice[]>([])
const isRefreshingVoices = ref(false)
const isPreviewingVoice = ref(false)
const showVoiceHelp = ref(false)
const ragStats = ref({ documents: 0, chunks: 0 })
const isIndexingRag = ref(false)
const ragStatusMessage = ref('')

let statusInterval: NodeJS.Timeout | null = null

const {
  codexAuthStatus,
  checkCodexAuthStatus,
  startCodexAuth,
  disconnectCodex,
} = useCodexAuth()

const getTargetValue = (event: Event): string => {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

const updateServiceStatus = async () => {
  try {
    await backendApi.initialize()

    // Check each service status
    const [sttReady, ttsReady, embeddingsReady] = await Promise.all([
      backendApi.isSTTReady().catch(() => false),
      backendApi.isTTSReady().catch(() => false),
      backendApi.isEmbeddingsReady().catch(() => false),
    ])

    serviceStatus.value = {
      stt: { status: sttReady ? 'ready' : 'error' },
      tts: { status: ttsReady ? 'ready' : 'error' },
      embeddings: { status: embeddingsReady ? 'ready' : 'error' },
    }
  } catch (error) {
    console.warn('Failed to get service status:', error)
    serviceStatus.value = {
      stt: { status: 'offline' },
      tts: { status: 'offline' },
      embeddings: { status: 'offline' },
    }
  }
}

const getServiceStatusClass = (service: 'stt' | 'tts' | 'embeddings') => {
  const status = serviceStatus.value[service].status
  switch (status) {
    case 'ready':
      return 'bg-green-500'
    case 'downloading':
      return 'bg-yellow-500'
    case 'error':
      return 'bg-red-500'
    case 'offline':
    default:
      return 'bg-gray-500'
  }
}

const getServiceStatusText = (service: 'stt' | 'tts' | 'embeddings') => {
  const status = serviceStatus.value[service].status
  const serviceNames = {
    stt: 'Speech-to-Text',
    tts: 'Text-to-Speech',
    embeddings: 'Embeddings',
  }

  switch (status) {
    case 'ready':
      return `${serviceNames[service]} service is ready`
    case 'downloading':
      return `${serviceNames[service]} model is downloading`
    case 'error':
      return `${serviceNames[service]} service has errors`
    case 'offline':
    default:
      return `${serviceNames[service]} service is offline`
  }
}

// Voice management computed properties and functions
const groupedVoices = computed(() => {
  const groups: Record<string, Voice[]> = {}
  // Filter out male voices
  const femaleVoices = availableVoices.value.filter(
    voice => voice.gender !== 'male'
  )
  femaleVoices.forEach(voice => {
    const lang = voice.language || 'unknown'
    if (!groups[lang]) groups[lang] = []
    groups[lang].push(voice)
  })

  // Sort voices within each language group by name
  Object.keys(groups).forEach(lang => {
    groups[lang].sort((a, b) => a.name.localeCompare(b.name))
  })

  return groups
})

const getLanguageDisplayName = (langCode: string): string => {
  const languageMap: Record<string, string> = {
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'es-ES': 'Spanish (Spain)',
    'es-MX': 'Spanish (Mexico)',
    'fr-FR': 'French',
    'de-DE': 'German',
    'it-IT': 'Italian',
    'pt-BR': 'Portuguese (Brazil)',
    'ru-RU': 'Russian',
    'zh-CN': 'Chinese (Mandarin)',
    'ja-JP': 'Japanese',
    'nl-NL': 'Dutch',
    'no-NO': 'Norwegian',
    'sv-SE': 'Swedish',
    'da-DK': 'Danish',
    'fi-FI': 'Finnish',
    'pl-PL': 'Polish',
    'uk-UA': 'Ukrainian',
    'hi-IN': 'Hindi',
    'ar-JO': 'Arabic',
  }
  return languageMap[langCode] || langCode
}

const getLanguageFlag = (langCode: string): string => {
  const flagMap: Record<string, string> = {
    'en-US': '🇺🇸',
    'en-GB': '🇬🇧',
    'es-ES': '🇪🇸',
    'es-MX': '🇲🇽',
    'fr-FR': '🇫🇷',
    'de-DE': '🇩🇪',
    'it-IT': '🇮🇹',
    'pt-BR': '🇧🇷',
    'ru-RU': '🇷🇺',
    'zh-CN': '🇨🇳',
    'ja-JP': '🇯🇵',
    'nl-NL': '🇳🇱',
    'no-NO': '🇳🇴',
    'sv-SE': '🇸🇪',
    'da-DK': '🇩🇰',
    'fi-FI': '🇫🇮',
    'pl-PL': '🇵🇱',
    'uk-UA': '🇺🇦',
    'hi-IN': '🇮🇳',
    'ar-JO': '🇯🇴',
  }
  return flagMap[langCode] || '🌍'
}

const getVoiceDisplayName = (voice: Voice): string => {
  const quality = getVoiceQuality(voice.name)
  const genderIcon =
    voice.gender === 'male' ? '👨' : voice.gender === 'female' ? '👩' : '👥'
  return `${genderIcon} ${voice.description || voice.name} (${quality})`
}

const getVoiceQuality = (voiceName: string): string => {
  if (voiceName.includes('-x_low')) return 'x_low'
  if (voiceName.includes('-low')) return 'low'
  if (voiceName.includes('-medium')) return 'medium'
  if (voiceName.includes('-high')) return 'high'
  return 'unknown'
}

const previewVoice = async () => {
  if (!props.currentSettings.localTtsVoice || isPreviewingVoice.value) return

  isPreviewingVoice.value = true
  try {
    await backendApi.initialize()

    // Get sample text based on language
    const selectedVoice = availableVoices.value.find(
      v => v.name === props.currentSettings.localTtsVoice
    )
    const sampleTexts: Record<string, string> = {
      'en-US': 'Hello! This is a preview of the Amy voice.',
      'en-GB': 'Good day! This is a preview of this British voice.',
      'es-ES': 'Hola, este es un ejemplo de esta voz en español.',
      'es-MX': 'Hola, este es un ejemplo de esta voz mexicana.',
      'fr-FR': 'Bonjour, ceci est un exemple de cette voix française.',
      'de-DE': 'Hallo, das ist ein Beispiel dieser deutschen Stimme.',
      'it-IT': 'Ciao, questo è un esempio di questa voce italiana.',
      'pt-BR': 'Olá, este é um exemplo desta voz brasileira.',
      'ru-RU': 'Привет, это пример этого русского голоса.',
      'zh-CN': '你好，这是这个中文声音的示例。',
      'ja-JP': 'こんにちは、これはこの日本語の音声のサンプルです。',
      'nl-NL': 'Hallo, dit is een voorbeeld van deze Nederlandse stem.',
      'no-NO': 'Hei, dette er et eksempel på denne norske stemmen.',
      'sv-SE': 'Hej, det här är ett exempel på denna svenska röst.',
      'da-DK': 'Hej, dette er et eksempel på denne danske stemme.',
      'fi-FI': 'Hei, tämä on esimerkki tästä suomalaisesta äänestä.',
      'pl-PL': 'Cześć, to jest przykład tego polskiego głosu.',
      'uk-UA': 'Привіт, це приклад цього українського голосу.',
      'hi-IN': 'नमस्ते, यह इस हिंदी आवाज़ का उदाहरण है।',
      'ar-JO': 'مرحبا، هذا مثال على هذا الصوت العربي.',
    }

    const sampleText =
      sampleTexts[selectedVoice?.language || 'en-US'] ||
      'Hello, this is a voice preview.'

    const result = await backendApi.synthesizeSpeech(
      sampleText,
      props.currentSettings.localTtsVoice
    )

    // Play the audio
    const audioData = new Uint8Array(result.audio)
    const blob = new Blob([audioData], { type: 'audio/wav' })
    const audioUrl = URL.createObjectURL(blob)
    const audio = new Audio(audioUrl)

    audio.play().catch(console.error)

    // Clean up URL after playing
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl)
    })
  } catch (error) {
    console.warn('Failed to preview voice:', error)
  } finally {
    isPreviewingVoice.value = false
  }
}

const refreshVoices = async () => {
  if (isRefreshingVoices.value) return

  isRefreshingVoices.value = true
  try {
    await backendApi.initialize()
    const voices = await backendApi.getAvailableVoices()
    availableVoices.value = voices
    console.log('Available voices loaded:', voices)
  } catch (error) {
    console.warn('Failed to load voices:', error)
    availableVoices.value = []
  } finally {
    isRefreshingVoices.value = false
  }
}

const onVoiceChange = async () => {
  try {
    await backendApi.initialize()
    await backendApi.setDefaultVoice(props.currentSettings.localTtsVoice)
    console.log('Default voice updated:', props.currentSettings.localTtsVoice)
  } catch (error) {
    console.warn('Failed to update default voice:', error)
  }
}

onMounted(async () => {
  if (props.section === 'voice') {
    updateServiceStatus()
    statusInterval = setInterval(updateServiceStatus, 10000)
  } // Check every 10 seconds

  // Load voices if local TTS is selected
  if (props.currentSettings.ttsProvider === 'local') {
    await refreshVoices()
  }

  if (props.section === 'knowledge') await refreshRagStats()
})

// Watch for TTS provider changes to load voices
watch(
  () => props.currentSettings.ttsProvider,
  async newProvider => {
    if (newProvider === 'local') {
      await refreshVoices()
    }
  }
)

onUnmounted(() => {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
})

const refreshRagStats = async () => {
  try {
    const result = await window.aliceIPC.invoke('rag:stats')
    if (result.success && result.data) {
      ragStats.value = result.data
    }
  } catch (error) {
    console.warn('Failed to load RAG stats:', error)
  }
}

const selectRagPaths = async () => {
  try {
    const result = await window.aliceIPC.invoke('rag:select-paths')
    if (!result.success || !Array.isArray(result.data)) {
      return
    }
    const updated = Array.from(
      new Set([...props.currentSettings.ragPaths, ...result.data])
    )
    emit('update:setting', 'ragPaths', updated)
    await indexRagPaths(updated)
  } catch (error) {
    console.warn('Failed to select RAG paths:', error)
  }
}

const indexRagPaths = async (paths: string[]) => {
  const normalizedPaths = Array.from(paths || []).map(String)
  if (normalizedPaths.length === 0) return
  isIndexingRag.value = true
  ragStatusMessage.value = 'Indexing...'
  try {
    const result = await window.aliceIPC.invoke('rag:index-paths', {
      paths: normalizedPaths,
      recursive: true,
    })
    if (result.success && result.data) {
      ragStatusMessage.value = `Indexed ${result.data.indexed}, skipped ${result.data.skipped}`
    } else {
      ragStatusMessage.value = result.error || 'Indexing failed'
    }
  } catch (error) {
    ragStatusMessage.value = 'Indexing failed'
  } finally {
    isIndexingRag.value = false
    await refreshRagStats()
  }
}

const reindexRag = async () => {
  await indexRagPaths(props.currentSettings.ragPaths)
}

const clearRagIndex = async () => {
  isIndexingRag.value = true
  ragStatusMessage.value = 'Clearing index...'
  try {
    await window.aliceIPC.invoke('rag:clear')
    ragStatusMessage.value = 'Index cleared'
  } catch (error) {
    ragStatusMessage.value = 'Failed to clear index'
  } finally {
    isIndexingRag.value = false
    await refreshRagStats()
  }
}

const removeRagPath = (pathItem: string) => {
  const updated = props.currentSettings.ragPaths.filter(
    item => item !== pathItem
  )
  emit('update:setting', 'ragPaths', updated)
  removeRagDocuments(pathItem)
}

const removeRagDocuments = async (pathItem: string) => {
  isIndexingRag.value = true
  ragStatusMessage.value = 'Removing documents...'
  try {
    const result = await window.aliceIPC.invoke('rag:remove-paths', {
      paths: [pathItem],
    })
    if (result.success && result.data) {
      ragStatusMessage.value = `Removed ${result.data.removed} documents`
    } else {
      ragStatusMessage.value = result.error || 'Failed to remove documents'
    }
  } catch (error) {
    ragStatusMessage.value = 'Failed to remove documents'
  } finally {
    isIndexingRag.value = false
    await refreshRagStats()
  }
}
</script>
