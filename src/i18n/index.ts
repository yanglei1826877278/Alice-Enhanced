import { computed, readonly, ref, watch } from 'vue'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export type UiLocale = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'alice.ui-locale'
const locales: Record<UiLocale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

function detectLocale(): UiLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

const locale = ref<UiLocale>(detectLocale())
const textState = new WeakMap<Text, { source: string; rendered: string }>()
const attributeState = new WeakMap<
  Element,
  Map<string, { source: string; rendered: string }>
>()
const translatableAttributes = ['aria-label', 'placeholder', 'title', 'alt']
let observer: MutationObserver | undefined
let observedRoot: HTMLElement | undefined

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function translate(value: string): string {
  const key = normalize(value)
  if (!key) return value
  return locales[locale.value][key] ?? value
}

function localizeTextNode(node: Text): void {
  const current = node.data
  const previous = textState.get(node)
  const source =
    previous && current === previous.rendered ? previous.source : current
  const normalized = normalize(source)
  if (!normalized) return

  const translated = translate(normalized)
  const leading = source.match(/^\s*/)?.[0] ?? ''
  const trailing = source.match(/\s*$/)?.[0] ?? ''
  const rendered =
    translated === normalized ? source : `${leading}${translated}${trailing}`
  textState.set(node, { source, rendered })
  if (current !== rendered) node.data = rendered
}

function localizeAttributes(element: Element): void {
  let states = attributeState.get(element)
  if (!states) {
    states = new Map()
    attributeState.set(element, states)
  }

  for (const name of translatableAttributes) {
    const current = element.getAttribute(name)
    if (!current) continue
    const previous = states.get(name)
    const source =
      previous && current === previous.rendered ? previous.source : current
    const rendered = translate(source)
    states.set(name, { source, rendered })
    if (current !== rendered) element.setAttribute(name, rendered)
  }
}

function localizeNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    localizeTextNode(node as Text)
    return
  }
  if (!(node instanceof Element)) return

  localizeAttributes(node)
  const walker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  )
  let child = walker.nextNode()
  while (child) {
    if (child.nodeType === Node.TEXT_NODE) localizeTextNode(child as Text)
    else localizeAttributes(child as Element)
    child = walker.nextNode()
  }
}

function refreshDocument(): void {
  if (observedRoot) localizeNode(observedRoot)
  document.documentElement.lang = locale.value
}

export function setLocale(nextLocale: UiLocale): void {
  locale.value = nextLocale
}

export function startDomLocalization(root: HTMLElement): () => void {
  observer?.disconnect()
  observedRoot = root
  localizeNode(root)
  observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') localizeNode(mutation.target)
      else if (mutation.type === 'attributes')
        localizeAttributes(mutation.target as Element)
      else mutation.addedNodes.forEach(localizeNode)
    }
  })
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: translatableAttributes,
  })
  refreshDocument()
  return () => observer?.disconnect()
}

watch(locale, value => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // The current window still switches even when persistence is unavailable.
  }
  refreshDocument()
})

window.addEventListener('storage', event => {
  if (
    event.key === STORAGE_KEY &&
    (event.newValue === 'zh-CN' || event.newValue === 'en-US')
  ) {
    locale.value = event.newValue
  }
})

export function useI18n() {
  return {
    locale: readonly(locale),
    isChinese: computed(() => locale.value === 'zh-CN'),
    setLocale,
    t: translate,
  }
}
