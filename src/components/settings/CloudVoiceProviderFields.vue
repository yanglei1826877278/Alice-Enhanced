<template>
  <div class="space-y-4">
    <div v-if="uses('doubao')" class="space-y-3">
      <p class="text-sm opacity-70">
        豆包语音使用语音控制台的 API Key，与方舟聊天模型的 Key 分开配置。
      </p>
      <label class="form-control block">
        <span class="block text-sm mb-1">Doubao Speech API Key *</span>
        <input
          v-model="settings.VITE_DOUBAO_SPEECH_API_KEY"
          type="password"
          autocomplete="new-password"
          class="input input-bordered w-full"
          placeholder="Speech console API Key"
        />
      </label>
      <p v-if="settings.sttProvider === 'doubao'" class="text-xs opacity-70">
        语音识别使用流式识别 2.0 小时版的一句话接口，需要开通 volc.seedasr.sauc.duration。
      </p>
      <template v-if="settings.ttsProvider === 'doubao'">
        <label class="form-control block"
          ><span class="block text-sm mb-1">Doubao TTS Resource ID *</span
          ><input
            v-model="settings.doubaoTtsResourceId"
            class="input input-bordered w-full"
            placeholder="seed-tts-2.0"
        /></label>
        <label class="form-control block"
          ><span class="block text-sm mb-1">Doubao Voice ID *</span
          ><input
            v-model="settings.doubaoTtsVoice"
            class="input input-bordered w-full"
            placeholder="zh_female_vv_uranus_bigtts"
        /></label>
        <label class="form-control block">
          <span class="flex items-center justify-between gap-3 text-sm mb-2">
            <span>语速</span>
            <output class="tabular-nums text-primary font-medium">
              {{ speechRateLabel }}
            </output>
          </span>
          <input
            v-model.number="settings.doubaoTtsSpeechRate"
            type="range"
            min="-50"
            max="100"
            step="5"
            class="range range-primary range-sm w-full"
          />
          <span class="relative mt-1 block h-4 text-xs opacity-60" aria-hidden="true">
            <span class="absolute left-0">0.5×</span>
            <span class="absolute left-1/3 -translate-x-1/2">1.0×</span>
            <span class="absolute right-0">2.0×</span>
          </span>
        </label>
        <p class="text-xs opacity-70">
          音色和资源 ID 需与已开通的服务匹配，可填写控制台中的音色 ID。
        </p>
      </template>
    </div>
    <div v-if="uses('tencent')" class="space-y-3">
      <label class="form-control block"
        ><span class="block text-sm mb-1">Tencent Cloud SecretId *</span
        ><input
          v-model="settings.VITE_TENCENT_SECRET_ID"
          type="password"
          autocomplete="new-password"
          class="input input-bordered w-full"
          placeholder="AKID..."
      /></label>
      <label class="form-control block"
        ><span class="block text-sm mb-1">Tencent Cloud SecretKey *</span
        ><input
          v-model="settings.VITE_TENCENT_SECRET_KEY"
          type="password"
          autocomplete="new-password"
          class="input input-bordered w-full"
          placeholder="SecretKey"
      /></label>
      <label
        v-if="settings.sttProvider === 'tencent'"
        class="form-control block"
        ><span class="block text-sm mb-1">Tencent ASR Engine *</span
        ><input
          v-model="settings.tencentSttEngine"
          class="input input-bordered w-full"
          placeholder="16k_zh"
      /></label>
      <p v-if="settings.sttProvider === 'tencent'" class="text-xs opacity-70">
        一句话识别支持 60 秒以内的录音；中文用 16k_zh，英文用 16k_en。
      </p>
      <label
        v-if="settings.ttsProvider === 'tencent'"
        class="form-control block"
        ><span class="block text-sm mb-1">Tencent TTS Voice ID *</span
        ><input
          v-model="settings.tencentTtsVoice"
          type="text"
          inputmode="numeric"
          class="input input-bordered w-full"
          placeholder="1001"
      /></label>
      <p class="text-xs opacity-70">
        请在腾讯云开通对应的语音识别／语音合成服务，音色 ID
        可从语音合成控制台获取。
      </p>
    </div>
    <div v-if="uses('custom')" class="space-y-3">
      <label class="form-control block"
        ><span class="block text-sm mb-1">Speech Base URL *</span
        ><input
          v-model="settings.customSpeechBaseUrl"
          type="url"
          class="input input-bordered w-full"
          placeholder="https://example.com/v1"
      /></label>
      <label class="form-control block"
        ><span class="block text-sm mb-1">Speech API Key *</span
        ><input
          v-model="settings.VITE_CUSTOM_SPEECH_API_KEY"
          type="password"
          autocomplete="new-password"
          class="input input-bordered w-full"
          placeholder="Your speech API key"
      /></label>
      <label v-if="settings.sttProvider === 'custom'" class="form-control block"
        ><span class="block text-sm mb-1">Transcription Model *</span
        ><input
          v-model="settings.customSttModel"
          class="input input-bordered w-full"
          placeholder="whisper-1"
      /></label>
      <template v-if="settings.ttsProvider === 'custom'">
        <label class="form-control block"
          ><span class="block text-sm mb-1">Speech Model *</span
          ><input
            v-model="settings.customTtsModel"
            class="input input-bordered w-full"
            placeholder="tts-1"
        /></label>
        <label class="form-control block"
          ><span class="block text-sm mb-1">Voice *</span
          ><input
            v-model="settings.customTtsVoice"
            class="input input-bordered w-full"
            placeholder="alloy"
        /></label>
      </template>
      <p class="text-xs opacity-70">
        该服务需支持 OpenAI 格式的 /audio/transcriptions 或
        /audio/speech，聊天兼容并不代表支持语音。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ settings: any }>()
const uses = (provider: string) =>
  props.settings.sttProvider === provider ||
  props.settings.ttsProvider === provider

const speechRateLabel = computed(() => {
  const rate = Number(props.settings.doubaoTtsSpeechRate) || 0
  return `${rate > 0 ? '+' : ''}${rate} · ${(1 + rate / 100).toFixed(2)}×`
})
</script>
