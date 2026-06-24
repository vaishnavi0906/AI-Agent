/**
 * Demo: self-healing locators on GitHub login page.
 *
 * This test uses plain @playwright/test — no fixture changes needed.
 * The patch in playwright.config.ts handles everything automatically.
 */
import { test, expect } from '@playwright/test'

test('heal broken selectors on GitHub login', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('https://github.com/login')

  // ── These selectors are intentionally broken ──────────────────────────
  // Real: #login_field  →  we use a broken ID
  await page.locator('#username-broken').fill('testuser@example.com')

  // Real: #password  →  we use a broken ID
  await page.locator('#password-broken').fill('fakepassword123')

  // Real: input[type=submit]  →  we use a broken ID
  await page.locator('#signin-button-broken').click()

  // Regardless of login result — still on github.com
  await expect(page).toHaveURL(/github\.com/)
})
