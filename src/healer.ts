import Anthropic from '@anthropic-ai/sdk'
import type { Page } from 'playwright-core'
import { LocatorStore } from './store.js'

const client = new Anthropic()

export interface VisualHealResult {
  selector: string
  confidence: number
  reasoning: string
}

/**
 * Visual healer — takes a screenshot of the current page and asks Claude
 * to identify what element the broken selector was targeting.
 * This is "video mode": Claude sees the page exactly as a human would.
 */
export async function visualHeal(
  page: Page,
  brokenSelector: string,
  action: string,
): Promise<VisualHealResult | null> {
  let screenshot: Buffer
  try {
    screenshot = await page.screenshot({ type: 'png', fullPage: false })
  } catch {
    return null
  }

  const prompt = `You are a Playwright test automation expert.

A test is trying to perform the action "${action}" on an element but the locator broke.
Broken selector: "${brokenSelector}"

Look at this screenshot and find the element that best matches what "${brokenSelector}" was targeting.

Return ONLY a JSON object (no markdown):
{
  "selector": "the best Playwright CSS selector or aria selector to target this element",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explanation"
}

Prefer selectors in this order:
1. [data-testid="..."]
2. [aria-label="..."]
3. role + accessible name e.g. button:has-text("Submit")
4. input[name="..."] or input[type="..."][placeholder="..."]
5. text selector e.g. text=Sign in
6. CSS selector`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshot.toString('base64'),
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.trim()) as VisualHealResult
    if (!parsed.selector || typeof parsed.confidence !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

// Singleton store shared across the patched session
let _store: LocatorStore | null = null

export function getStore(): LocatorStore {
  if (!_store) _store = new LocatorStore()
  return _store
}
