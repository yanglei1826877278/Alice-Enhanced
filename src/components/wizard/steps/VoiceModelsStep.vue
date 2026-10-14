<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-2xl font-semibold mb-2">
        Choose Voice &amp; Memory Providers
      </h2>
      <p class="text-base-content/70">
        语音识别、语音合成和记忆可以使用不同的服务商，与聊天模型独立配置。
      </p>
    </div>

    <div class="bg-base-300/50 p-3 rounded-lg">
      <label class="label w-full cursor-pointer">
        <span class="flex-1 pr-4">
          <span class="block font-medium text-lg">Use Local Models</span>
          <span class="block text-sm text-base-content/60 mt-1"
            >一键使用本地 Whisper、Piper 和记忆向量，无需云端 API key。</span
          >
        </span>
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-lg shrink-0"
          :checked="formData.useLocalModels"
          @change="
            $emit('toggle-local', ($event.target as HTMLInputElement).checked)
          "
        />
      </label>
    </div>

    <div v-if="formData.useLocalModels" class="alert alert-success text-sm">
      <span
        >语音识别：本地 Whisper；语音合成：本地
        Piper；记忆：本地向量模型。所需模型在首次使用时下载，可在设置中调整。</span
      >
    </div>
    <div v-else class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <button
          class="btn btn-sm btn-outline"
          @click="selectVoicePreset('doubao')"
        >
          豆包语音
        </button>
        <button
          class="btn btn-sm btn-outline"
          @click="selectVoicePreset('tencent')"
        >
          腾讯云语音
        </button>
        <button
          class="btn btn-sm btn-outline"
          @click="selectVoicePreset('custom')"
        >
          自定义语音接口
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label for="wizard-stt-provider" class="label"
            ><span class="label-text font-medium"
              >Speech-to-Text Provider</span
            ></label
          >
          <select
            id="wizard-stt-provider"
            v-model="formData.sttProvider"
            class="select select-bordered w-full"
          >
            <option value="doubao">豆包语音 (Doubao)</option>
            <option value="tencent">腾讯云语音 (Tencent Cloud)</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
            <option value="openai">OpenAI</option>
            <option value="groq">Groq</option>
            <option value="google">Google Cloud</option>
            <option value="local">Local Whisper</option>
          </select>
        </div>
        <div class="form-control">
          <label for="wizard-tts-provider" class="label"
            ><span class="label-text font-medium"
              >Text-to-Speech Provider</span
            ></label
          >
          <select
            id="wizard-tts-provider"
            v-model="formData.ttsProvider"
            class="select select-bordered w-full"
          >
            <option value="doubao">豆包语音 (Doubao)</option>
            <option value="tencent">腾讯云语音 (Tencent Cloud)</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google Cloud</option>
            <option value="local">Local Piper</option>
          </select>
        </div>
      </div>

      <div class="form-control">
        <label for="wizard-embedding-provider" class="label"
          ><span class="label-text font-medium">Memory Embeddings</span></label
        >
        <select
          id="wizard-embedding-provider"
          v-model="formData.embeddingProvider"
          class="select select-bordered w-full"
        >
          <option value="local">Local (无需 API key)</option>
          <option value="openai">OpenAI</option>
        </select>
        <p class="text-xs text-base-content/60 mt-2">
          本地记忆可以搭配任意云端语音服务，不需要 OpenAI key。
        </p>
      </div>

      <CloudVoiceProviderFields :settings="formData" />

      <div v-if="needsOpenAI" class="form-control">
        <label for="wizard-voice-openai-key" class="label"
          ><span class="label-text">OpenAI API Key</span></label
        >
        <input
          id="wizard-voice-openai-key"
          v-model="formData.VITE_OPENAI_API_KEY"
          type="password"
          autocomplete="new-password"
          placeholder="sk-..."
          class="input input-bordered w-full"
        />
        <p class="text-xs text-base-content/60 mt-1">
          仅所选的 OpenAI 功能需要此 key。
        </p>
      </div>
      <div v-if="formData.sttProvider === 'groq'" class="form-control">
        <label for="wizard-groq-key" class="label"
          ><span class="label-text">Groq API Key</span></label
        >
        <input
          id="wizard-groq-key"
          v-model="formData.VITE_GROQ_API_KEY"
          type="password"
          autocomplete="new-password"
          placeholder="gsk_..."
          class="input input-bordered w-full"
        />
      </div>
      <div
        v-if="
          formData.sttProvider === 'google' || formData.ttsProvider === 'google'
        "
        class="form-control"
      >
        <label for="wizard-google-key" class="label"
          ><span class="label-text">Google Cloud API Key</span></label
        >
        <input
          id="wizard-google-key"
          v-model="formData.VITE_GOOGLE_API_KEY"
          type="password"
          autocomplete="new-password"
          placeholder="AIza..."
          class="input input-bordered w-full"
        />
      </div>
      <div
        v-if="
          formData.sttProvider === 'google' || formData.sttProvider === 'local'
        "
        class="form-control"
      >
        <label for="wizard-stt-language" class="label"
          ><span class="label-text">Recognition Language</span></label
        >
        <select
          id="wizard-stt-language"
          v-model="formData.localSttLanguage"
          class="select select-bordered w-full"
        >
          <option value="auto">Auto-detect (Google defaults to English)</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="it">Italiano</option>
          <option value="pt">Português</option>
          <option value="ru">Русский</option>
          <option value="ar">العربية</option>
          <option value="hi">हिन्दी</option>
          <option value="tr">Türkçe</option>
          <option value="pl">Polski</option>
          <option value="nl">Nederlands</option>
          <option value="sv">Svenska</option>
          <option value="da">Dansk</option>
          <option value="no">Norsk</option>
          <option value="fi">Suomi</option>
        </select>
      </div>

      <p v-if="configurationError" class="text-sm text-warning" role="status">
        {{ configurationError }}
      </p>
    </div>

    <div class="bg-base-200 p-4 rounded-lg space-y-2">
      <h3 class="font-medium">Current Configuration</h3>
      <div class="flex justify-between gap-3 text-sm">
        <span class="text-base-content/60">Speech-to-Text</span
        ><span>{{ voiceProviderLabel(formData.sttProvider) }}</span>
      </div>
      <div class="flex justify-between gap-3 text-sm">
        <span class="text-base-content/60">Text-to-Speech</span
        ><span>{{ voiceProviderLabel(formData.ttsProvider) }}</span>
      </div>
      <div class="flex justify-between gap-3 text-sm">
        <span class="text-base-content/60">Memory Embeddings</span
        ><span>{{ voiceProviderLabel(formData.embeddingProvider) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CloudVoiceProviderFields from '../../settings/CloudVoiceProviderFields.vue'
import {
  getVoiceConfigurationError,
  voiceProviderLabel,
} from '../../../services/voiceProviderConfig'

const props = defineProps<{ formData: any }>()
defineEmits<{ 'toggle-local': [useLocal: boolean] }>()
const needsOpenAI = computed(() =>
  [
    props.formData.sttProvider,
    props.formData.ttsProvider,
    props.formData.embeddingProvider,
  ].includes('openai')
)
const configurationError = computed(() =>
  getVoiceConfigurationError(props.formData)
)
const selectVoicePreset = (provider: 'doubao' | 'tencent' | 'custom') => {
  props.formData.sttProvider = provider
  props.formData.ttsProvider = provider
  props.formData.embeddingProvider = 'local'
}
</script>
