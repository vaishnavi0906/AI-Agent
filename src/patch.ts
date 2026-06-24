/**
 * ai-self-heal-engine — Plan B interceptor
 *
 * Add ONE line to playwright.config.ts:
 *   import 'ai-self-heal-engine/patch'
 *
 * Every locator in every test now has an automatic Plan B.
 * When a locator can't find its element → screenshot → Claude identifies it
 * → retries with healed selector → stores to cache for next run.
 */

import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { visualHeal, getStore } from './healer.js'

export interface PatchOptions {
  confidenceThreshold?: number  // 0–1, default 0.5
  verbose?: boolean             // default true
  disabled?: boolean            // default false
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
  // Launch a headless browser briefly just to get the Locator prototype
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
      // Quick existence check — instant, no waiting
      let exists = false
      try { exists = (await this.count()) > 0 } catch { /* ignore */ }

      // Element found → run action normally
      if (exists) {
        return await original.apply(this, args)
      }

      // ── Plan B ────────────────────────────────────────────────────
      const selector = selectorOf(this)
      let pw: Page
      try {
        pw = (this as unknown as { page(): Page }).page()
      } catch {
        return await original.apply(this, args) // no page → run normally (will fail naturally)
      }

      const url = pw.url()
      const store = getStore()

      // Step 1: cache
      const cached = store.get(selector, url)
      if (cached) {
        try {
          const r = await original.apply(pw.locator(cached.healed), args)
          if (_opts.verbose) console.log(`\n🔧 [self-heal] cache: "${selector}" → "${cached.healed}"`)
          return r
        } catch { /* stale cache → fall through */ }
      }

      // Step 2: visual — Claude sees the page
      if (_opts.verbose) console.log(`\n🔧 [self-heal] "${selector}" not found → asking Claude...`)
      const healed = await visualHeal(pw, selector, action)

      if (!healed || healed.confidence < _opts.confidenceThreshold) {
        if (_opts.verbose) console.log(`  ✗ could not heal`)
        return await original.apply(this, args) // let test fail naturally
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
        return await original.apply(this, args) // let test fail naturally
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
  // Run async patch — Playwright config loading is async-compatible
  patchLocatorPrototype().catch(e => {
    console.warn('[self-heal] Could not install patch:', e.message)
  })
}

// Auto-install on import
installPatch()
