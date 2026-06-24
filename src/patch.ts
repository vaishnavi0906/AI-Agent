import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { visualHeal, getStore } from './healer.js'

export interface PatchOptions {
  confidenceThreshold?: number
  verbose?: boolean
  disabled?: boolean
}

const DEFAULT_OPTS: Required<PatchOptions> = {
  confidenceThreshold: 0.5,
  verbose: true,
  disabled: false,
}

let _opts = { ...DEFAULT_OPTS }
let _patched = false

const ACTIONS = [
  'click', 'fill', 'type', 'press',
  'check', 'uncheck', 'selectOption',
  'hover', 'tap', 'focus', 'clear', 'dblclick',
] as const

function selectorOf(locator: object): string {
  const str = locator.toString()
  const match = str.match(/Locator@(?:css=)?(.+)$/)
  return match?.[1] ?? str
}

async function patchLocatorPrototype() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const sampleLocator = page.locator('div')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto: any = Object.getPrototypeOf(sampleLocator)
  await browser.close()

  for (const action of ACTIONS) {
    const original = proto[action]
    if (typeof original !== 'function' || original.__selfHealed) continue

    const patched = async function (this: typeof sampleLocator, ...args: unknown[]) {
      let exists = false
      try { exists = (await this.count()) > 0 } catch { /* ignore */ }

      if (exists) return await original.apply(this, args)

      const selector = selectorOf(this)
      let pw: Page
      try {
        pw = (this as unknown as { page(): Page }).page()
      } catch {
        return await original.apply(this, args)
      }

      const url = pw.url()
      const store = getStore()

      const cached = store.get(selector, url)
      if (cached) {
        try {
          const r = await original.apply(pw.locator(cached.healed), args)
          if (_opts.verbose) console.log(`\n🔧 [self-heal] cache: "${selector}" → "${cached.healed}"`)
          return r
        } catch { /* stale cache */ }
      }

      if (_opts.verbose) console.log(`\n🔧 [self-heal] "${selector}" not found → asking Claude...`)
      const healed = await visualHeal(pw, selector, action)

      if (!healed || healed.confidence < _opts.confidenceThreshold) {
        if (_opts.verbose) console.log(`  ✗ could not heal`)
        return await original.apply(this, args)
      }

      try {
        const r = await original.apply(pw.locator(healed.selector), args)
        store.save(selector, healed.selector, url, healed.confidence, 'visual')
        if (_opts.verbose) {
          console.log(`  ✓ healed: "${healed.selector}" (conf: ${healed.confidence})`)
          console.log(`  💬 ${healed.reasoning}`)
        }
        return r
      } catch {
        return await original.apply(this, args)
      }
    }

    patched.__selfHealed = true
    proto[action] = patched
  }

  if (_opts.verbose) console.log('🛡️  [self-heal] Plan B active — all locators covered')
}

export function installPatch(options: PatchOptions = {}) {
  _opts = { ...DEFAULT_OPTS, ...options }
  if (_opts.disabled || _patched) return
  _patched = true
  patchLocatorPrototype().catch(e => {
    console.warn('[self-heal] Could not install patch:', e.message)
  })
}

installPatch()
