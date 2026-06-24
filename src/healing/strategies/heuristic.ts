import type { Page } from '@playwright/test'
import type { LocatorType } from '../LocatorStore.js'

export interface StrategyResult {
  selector: string
  locator_type: LocatorType
  role_name?: string
  confidence: number
}

export function extractHints(selector: string): {
  words: string[]
  testId: string | null
  id: string | null
  classNames: string[]
  likelyRoles: string[]
} {
  const testIdMatch = selector.match(/data-testid[=\["']+([^"'\]\s]+)/)
  const idMatch = selector.match(/^#([\w-]+)$/)

  const words = selector
    .replace(/[#.\[\]'"=*+~>^$|]/g, ' ')
    .split(/[-_\s]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 1 && !/^\d+$/.test(w))

  const classNames = [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1])

  // Infer likely ARIA roles from selector words — avoids scanning all 9 roles
  const ROLE_HINTS: Record<string, string> = {
    btn: 'button', button: 'button', submit: 'button', cta: 'button',
    link: 'link', href: 'link', nav: 'link',
    input: 'textbox', field: 'textbox', username: 'textbox',
    email: 'textbox', password: 'textbox', search: 'searchbox',
    text: 'textbox', name: 'textbox',
    check: 'checkbox', checkbox: 'checkbox',
    radio: 'radio',
    select: 'combobox', dropdown: 'combobox', combo: 'combobox',
    tab: 'tab',
    menu: 'menuitem',
  }

  const likelyRoles = [...new Set(
    words.map(w => ROLE_HINTS[w]).filter(Boolean)
  )]

  // If we couldn't infer, default to the two most common
  if (likelyRoles.length === 0) likelyRoles.push('button', 'textbox')

  return { words, testId: testIdMatch?.[1] ?? null, id: idMatch?.[1] ?? null, classNames, likelyRoles }
}

/** Safe locator.count() — returns 0 if page is closed mid-strategy */
async function safeCount(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn()
  } catch {
    return 0
  }
}

/**
 * Strategy 1 — ARIA / Role / TestId
 * Only tries roles inferred from the selector words — fast, targeted.
 */
export async function ariaStrategy(page: Page, selector: string): Promise<StrategyResult | null> {
  const hints = extractHints(selector)

  // 1a. data-testid exact
  if (hints.testId) {
    if (await safeCount(() => page.getByTestId(hints.testId!).count()) === 1)
      return { selector: hints.testId, locator_type: 'testid', confidence: 0.95 }
  }

  // 1b. Inferred roles only (not all 9)
  for (const role of hints.likelyRoles as Parameters<Page['getByRole']>[0][]) {
    // Try each meaningful word as accessible name
    for (const word of hints.words) {
      if (word.length < 3) continue
      if (await safeCount(() => page.getByRole(role, { name: word, exact: false }).count()) === 1)
        return { selector: role, locator_type: 'role', role_name: word, confidence: 0.9 }
    }
  }

  // 1c. aria-label with joined words
  const searchText = hints.words.join(' ')
  if (searchText.length > 2) {
    if (await safeCount(() => page.getByLabel(searchText, { exact: false }).count()) === 1)
      return { selector: searchText, locator_type: 'label', confidence: 0.85 }
  }

  return null
}

/**
 * Strategy 2 — Fuzzy Text / Placeholder
 */
export async function textStrategy(page: Page, selector: string): Promise<StrategyResult | null> {
  const hints = extractHints(selector)

  // Try placeholder first (good for inputs)
  for (const word of hints.words) {
    if (word.length < 3) continue
    if (await safeCount(() => page.getByPlaceholder(word, { exact: false }).count()) === 1)
      return { selector: word, locator_type: 'placeholder', confidence: 0.85 }
  }

  // Try visible text
  for (const word of hints.words) {
    if (word.length < 3) continue
    if (await safeCount(() => page.getByText(word, { exact: false }).count()) === 1)
      return { selector: word, locator_type: 'text', confidence: 0.75 }
  }

  return null
}

/**
 * Strategy 3 — Structural / Tag+Class heuristics
 */
export async function structuralStrategy(page: Page, selector: string): Promise<StrategyResult | null> {
  const hints = extractHints(selector)

  const TAG_MAP: Record<string, string> = {
    btn: 'button', button: 'button', submit: 'button',
    input: 'input', field: 'input',
    link: 'a',
    select: 'select', dropdown: 'select',
  }

  for (const word of hints.words) {
    const tag = TAG_MAP[word]
    if (!tag) continue
    if (await safeCount(() => page.locator(tag).count()) === 1)
      return { selector: tag, locator_type: 'css', confidence: 0.6 }
  }

  for (const cls of hints.classNames) {
    if (cls.length < 4) continue
    if (await safeCount(() => page.locator(`[class*="${cls}"]`).count()) === 1)
      return { selector: `[class*="${cls}"]`, locator_type: 'css', confidence: 0.65 }
  }

  return null
}
