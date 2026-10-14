import './assets/styles.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router/main.ts'
import { initializeClients } from './services/apiClients'
import { registerCodexToolBridge } from './services/llmProviders/codexToolBridge'
import { startDomLocalization } from './i18n'

import App from './App.vue'

const app = createApp(App)

app.use(createPinia())
app.use(router)
registerCodexToolBridge()

async function startApp(): Promise<void> {
  try {
    await router.isReady()
  } catch (error) {
    console.error('Router failed to finish initial navigation:', error)
  }

  try {
    await initializeClients()
    console.log('All clients initialized, mounting app')
  } catch (error) {
    console.error('Failed to initialize clients, mounting app anyway:', error)
  } finally {
    app.mount('#app')
    const appRoot = document.querySelector<HTMLElement>('#app')
    if (appRoot) startDomLocalization(appRoot)
  }
}

void startApp()
