import type { Page } from '@playwright/test'
import type { LocatorType } from '../LocatorStore.js'

export interface StrategyResult {
  selector: string
  locator_type: LocatorType
  role_name?: string
  confidence: number
}

/**
 * Extracts semantic hints from a broken selector string.
 * e.g. "#submit-btn" → words: ["submit", "btn"], "#login-form" → words: ["login", "form"]
 */
export function extractHints(selector: string): {
  words: string[]
  testId: string | null
  id: string | null
  classNames: string[]
} {
  const testIdMatch = selector.match(/data-testid[=\["']+([^"'\]\s]+)/)
  const idMatch = selector.match(/^#([\w-]+)$/)

  const words = selector
    .replace(/[#.\[\]'"=*+~>^$|]/g, ' ')
    .split(/[-_\s]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 1 && !/^\d+$/.test(w))

  const classNames = [...selector.matchAll(/\.([\w-]+)/g)].map(m => m[1])

  return {
    words,
    testId: testIdMatch?.[1] ?? null,
    id: idMatch?.[1] ?? null,
    classNames,
  }
}

/**
 * Strategy 1 — ARIA / Role / TestId
 * Tries: data-testid, getByRole (button/link/textbox etc.), getByLabel
 * No LLM cost. Very fast.
 */
export async function ariaStrategy(page: Page, selector: string): Promise<StrategyResult | null> {
  const hints = extractHints(selector)
  const searchText = hints.words.join(' ')

  // 1a. data-testid exact
  if (hints.testId) {
    const loc = page.getByTestId(hints.testId)
    if (await loc.count() === 1) {
      return { selector: hints.testId, locator_type: 'testid', confidence: 0.95 }
    }
  }

  // 1b. Roles with matching name
  const roles = ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'option'] as const
  for (const role of roles) {
    for (const word of hints.words) {
      if (word.length < 3) continue
      const loc = page.getByRole(role, { name: word, exact: false })
      if (await loc.count() === 1) {
        return { selector: role, locator_type: 'role', role_name: word, confidence: 0.9 }
      }
    }
    // Try full joined text
    if (searchText.length > 2) {
      const loc = page.getByRole(role, { name: searchText, exact: false })
      if (await loc.count() === 1) {
        return { selector: role, locator_type: 'role', role_name: searchText, confidence: 0.88 }
      }
    }
  }

  // 1c. aria-label
  const loc = page.getByLabel(searchText, { exact: false })
  if (await loc.count() === 1) {
    return { selector: searchText, locator_type: 'label', confidence: 0.85 }
  }

  return null
}

/**
 * Strategy 2 — Fuzzy Text Match
 * Tries visible text content of the element.
 */
export async function textStrategy(page: Page, selector: string): Promise<StrategyResult | null> {
  const hints = extractHints(selector)

  for (const word of hints.words) {
    if (word.length < 3) continue
    const loc = page.getByText(word, { exact: false })
    if (await loc.count() === 1) {
      return { selector: word, locator_type: 'text', confidence: 0.75 }
    }
  }

  // Try placeholder
  const searchText = hints.words.join(' ')
  const loc = page.getByPlaceholder(searchText, { exact: false })
  if (await loc.count() === 1) {
    return { selector: searchText, locator_type: 'placeholder', confidence: 0.8 }
  }

  return null
}

/**
 * Strategy 3 — Structural / Tag+Position
 * Finds elements by tag name and approximate DOM position.
 * Lower confidence — uses CSS only.
 */
export async function structuralStrategy(page: Page, selector: string): Promise<StrategyResult | null> {
  const hints = extractHints(selector)

  // Map common words to tags
  const TAG_MAP: Record<string, string> = {
    btn: 'button', button: 'button',
    input: 'input', field: 'input', text: 'input',
    link: 'a', href: 'a',
    select: 'select', dropdown: 'select',
    form: 'form',
    img: 'img', image: 'img',
    heading: 'h1,h2,h3',
  }

  for (const word of hints.words) {
    const tag = TAG_MAP[word]
    if (!tag) continue
    const elements = page.locator(tag)
    const count = await elements.count()
    if (count === 1) {
      return { selector: tag, locator_type: 'css', confidence: 0.6 }
    }
  }

  // Try id-like class names
  for (const cls of hints.classNames) {
    if (cls.length < 4) continue
    const loc = page.locator(`[class*="${cls}"]`)
    if (await loc.count() === 1) {
      return { selector: `[class*="${cls}"]`, locator_type: 'css', confidence: 0.65 }
    }
  }

  return null
}
