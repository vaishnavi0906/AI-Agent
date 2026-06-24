import { test, expect } from '../src/fixture.js'

/**
 * Demonstrates the self-healing locator engine against TodoMVC.
 * "Broken" selectors intentionally use stale IDs/classes — the engine heals them.
 *
 * Convention:
 *   healPage.locator() — actions (click, fill, etc.) with auto-healing
 *   page.locator()     — assertions with expect() (no healing needed)
 */

test.use({
  healingOptions: {
    verbose: true,
    llmConfidenceThreshold: 0.6,
  },
})

// ── Demo 1: Stale CSS id ──────────────────────────────────────────────────
test('heal stale #id selector on todo app', async ({ page, healPage }) => {
  await healPage.goto('https://todomvc.com/examples/react/dist/')

  // Correct selector is .new-todo — broken one forces healing
  await healPage.locator('#new-todo-input').fill('Buy milk')
  await healPage.locator('#new-todo-input').press('Enter')

  await expect(page.locator('.todo-list li')).toHaveCount(1)
})

// ── Demo 2: Role-based healing ────────────────────────────────────────────
test('heal broken button selector', async ({ page, healPage }) => {
  await healPage.goto('https://todomvc.com/examples/react/dist/')

  // Add item using correct selector (no healing needed)
  await healPage.locator('.new-todo').fill('Write tests')
  await healPage.locator('.new-todo').press('Enter')

  // Stale toggle selector — engine heals it
  await healPage.locator('#toggle-all-checkbox').click()

  await expect(page.locator('.todo-list li')).toHaveCount(1)
})

// ── Demo 3: Heal stats report ─────────────────────────────────────────────
test('print heal stats after run', async ({ healingEngine }) => {
  const stats = healingEngine.getStore().stats()
  if (stats.length > 0) {
    console.table(stats)
  } else {
    console.log('[HealingEngine] No healed locators recorded yet.')
  }
  console.log(`Total healed locators stored: ${healingEngine.getStore().all().length}`)
})
