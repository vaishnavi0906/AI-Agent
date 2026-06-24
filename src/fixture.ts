import { test as base, type Page } from '@playwright/test'
import { HealingEngine, type HealingEngineOptions } from './healing/HealingEngine.js'
import { createHealingPage } from './healing/HealingLocator.js'

export type { HealingEngineOptions } from './healing/HealingEngine.js'
export { HealingEngine } from './healing/HealingEngine.js'
export { HealingLocator, createHealingPage, heal } from './healing/HealingLocator.js'
export { LocatorStore } from './healing/LocatorStore.js'

/** Test-scoped fixtures */
export interface HealingFixtures {
  /** Drop-in replacement for `page` — locators auto-heal on failure. */
  healPage: Page
}

/** Worker-scoped fixtures (shared across tests in the same worker) */
export interface HealingWorkerFixtures {
  /** The engine instance — access store stats, configure options. */
  healingEngine: HealingEngine
  /** Engine configuration — set via test.use({ healingOptions: {...} }) */
  healingOptions: HealingEngineOptions
}

/**
 * Extends Playwright's `test` with self-healing locator support.
 *
 * Fixtures:
 * - `healPage`      — Page proxy; every locator auto-heals on failure
 * - `healingEngine` — direct access to the HealingEngine (worker-scoped)
 *
 * Usage:
 * ```ts
 * import { test, expect } from '../src/fixture.js'
 *
 * test('login', async ({ healPage }) => {
 *   await healPage.goto('https://example.com')
 *   await healPage.locator('#old-username').fill('user')  // heals if broken
 *   await healPage.locator('#old-submit').click()
 * })
 * ```
 *
 * Configure:
 * ```ts
 * test.use({ healingOptions: { skipLLM: true, verbose: false } })
 * ```
 */
export const test = base.extend<HealingFixtures, HealingWorkerFixtures>({
  // Worker option — configure via test.use({ healingOptions: {...} })
  healingOptions: [
    {
      dbPath: '.healing/locators.db',
      llmConfidenceThreshold: 0.6,
      llmWithScreenshot: true,
      skipLLM: false,
      verbose: true,
    },
    { scope: 'worker', option: true },
  ],

  // Worker-scoped engine — one instance per worker, shared across tests
  healingEngine: [
    async ({ healingOptions }, use) => {
      const engine = new HealingEngine(healingOptions)
      await use(engine)
      engine.getStore().close()
    },
    { scope: 'worker' },
  ],

  // Test-scoped healing page proxy
  healPage: async ({ page, healingEngine }, use) => {
    const hp = createHealingPage(page, healingEngine)
    await use(hp)
  },
})

export { expect } from '@playwright/test'
