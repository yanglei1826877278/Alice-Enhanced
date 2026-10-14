/// <reference types="vite/client" />

import type {
  CustomToolsSnapshot,
  UploadCustomToolScriptResult,
  CustomToolExecutionResult,
  CustomToolDefinition,
} from '../types/customTools'
import type { CustomAvatarsSnapshot } from '../types/customAvatars'
import type { ActivatedSkill, SkillsSnapshot } from '../types/skills'
import type { PermissionMode, PermissionSnapshot } from '../types/permissions'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ElectronAppSettings {
  VITE_OPENAI_API_KEY?: string
  VITE_GOOGLE_API_KEY?: string
}

declare global {
  interface Window {
    aliceIPC: AliceIPC
    desktopAPI: AliceDesktopAPI
    electron: {
      resize: (dimensions: { width: number; height: number }) => void
      mini: (request: {
        minimize: boolean
        behavior?: 'corner' | 'taskbar'
      }) => void
      screenshot: () => void
      showOverlay: () => void
      getScreenshot: () => Promise<string | null>
      closeApp: () => void
    }
    settingsAPI: {
      loadSettings: () => Promise<ElectronAppSettings | null>
      saveSettings: (
        settings: any
      ) => Promise<{ success: boolean; error?: string }>
    }
    electronPaths: {
      getRendererDistPath: () => Promise<string>
    }
    httpAPI: {
      request: (args: {
        url: string
        method?: string
        headers?: Record<string, string>
        params?: Record<string, any>
        data?: any
        timeout?: number
      }) => Promise<{
        success: boolean
        data?: any
        status?: number
        statusText?: string
        headers?: any
        error?: string
        code?: string
        response?: {
          status: number
          statusText: string
          data: any
        }
      }>
    }
    customToolsAPI?: AliceCustomToolsAPI
    skillsAPI?: {
      list: () => Promise<{
        success: boolean
        data?: SkillsSnapshot
        error?: string
      }>
      scanUser: () => Promise<{
        success: boolean
        data?: SkillsSnapshot
        error?: string
      }>
      activate: (
        name: string
      ) => Promise<{ success: boolean; data?: ActivatedSkill; error?: string }>
      readFile: (
        name: string,
        file: string
      ) => Promise<{ success: boolean; data?: string; error?: string }>
      toggle: (
        name: string,
        enabled: boolean
      ) => Promise<{ success: boolean; data?: SkillsSnapshot; error?: string }>
      importFolder: () => Promise<{
        success: boolean
        data?: SkillsSnapshot | null
        error?: string
      }>
      remove: (
        name: string
      ) => Promise<{ success: boolean; data?: SkillsSnapshot; error?: string }>
    }
    customAvatarsAPI?: AliceCustomAvatarsAPI
    permissionsAPI: {
      get: () => Promise<{
        success: boolean
        data?: PermissionSnapshot
        error?: string
      }>
      setMode: (
        mode: PermissionMode
      ) => Promise<{
        success: boolean
        data?: PermissionSnapshot
        error?: string
      }>
      removeRule: (
        id: string
      ) => Promise<{
        success: boolean
        data?: PermissionSnapshot
        error?: string
      }>
      clearSession: () => Promise<{
        success: boolean
        data?: PermissionSnapshot
        error?: string
      }>
    }
  }
}

interface AliceIPC {
  on: (channel: string, listener: (...args: any[]) => void) => void
  off: (channel: string, listener: (...args: any[]) => void) => void
  removeAllListeners: (channel: string) => void
  send: (channel: string, ...args: any[]) => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

interface AliceDesktopAPI {
  listDirectory: (dirPath: string) => Promise<{
    success: boolean
    files?: string[]
    error?: string
  }>
  executeCommand: (args: { command: string; cwd?: string }) => Promise<{
    success: boolean
    output?: string
    error?: string
  }>
  readFile: (args: { path: string; maxChars?: number }) => Promise<{
    success: boolean
    data?: { path: string; text: string; truncated: boolean; size: number }
    error?: string
  }>
  viewImage: (args: { path: string }) => Promise<{
    success: boolean
    data?: {
      type: 'image'
      path: string
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
      size: number
      imageUrl: string
    }
    error?: string
  }>
  webFetch: (args: { url: string; maxChars?: number }) => Promise<{
    success: boolean
    data?: {
      url: string
      status: number
      contentType: string
      text: string
      truncated: boolean
    }
    error?: string
  }>
  process: (args: Record<string, any>) => Promise<{
    success: boolean
    data?: any
    error?: string
  }>
  delegateTask: (args: Record<string, any>) => Promise<{
    success: boolean
    data?: any
    error?: string
  }>
  manageDelegatedTask: (args: Record<string, any>) => Promise<{
    success: boolean
    data?: any
    error?: string
  }>
  writeTextFile: (args: {
    path: string
    content: string
    mode: 'create' | 'append' | 'overwrite'
  }) => Promise<{ success: boolean; data?: any; error?: string }>
  searchFiles: (args: {
    root: string
    pattern?: string
    query?: string
  }) => Promise<{ success: boolean; data?: any; error?: string }>
}

interface AliceCustomToolsAPI {
  list: () => Promise<{
    success: boolean
    data?: CustomToolsSnapshot
    error?: string
  }>
  refresh: () => Promise<{
    success: boolean
    data?: CustomToolsSnapshot
    error?: string
  }>
  replaceJson: (
    rawJson: string
  ) => Promise<{ success: boolean; data?: CustomToolsSnapshot; error?: string }>
  uploadScript: (
    fileName: string,
    data: ArrayBuffer | Uint8Array
  ) => Promise<{
    success: boolean
    data?: UploadCustomToolScriptResult
    error?: string
  }>
  upsert: (
    tool: Partial<CustomToolDefinition>
  ) => Promise<{ success: boolean; data?: CustomToolsSnapshot; error?: string }>
  toggle: (
    id: string,
    enabled: boolean
  ) => Promise<{ success: boolean; data?: CustomToolsSnapshot; error?: string }>
  delete: (
    id: string
  ) => Promise<{ success: boolean; data?: CustomToolsSnapshot; error?: string }>
  execute: (
    name: string,
    args?: Record<string, any>
  ) => Promise<{
    success: boolean
    data?: CustomToolExecutionResult
    error?: string
  }>
}

interface AliceCustomAvatarsAPI {
  list: () => Promise<{
    success: boolean
    data?: CustomAvatarsSnapshot
    error?: string
  }>
  refresh: () => Promise<{
    success: boolean
    data?: CustomAvatarsSnapshot
    error?: string
  }>
  setChatAvatar: (
    avatarId: string,
    imageBytes: Uint8Array
  ) => Promise<{
    success: boolean
    data?: CustomAvatarsSnapshot
    error?: string
  }>
}
