import Anthropic from '@anthropic-ai/sdk'
import type { Page } from 'playwright-core'
import { LocatorStore } from './store.js'

const client = new Anthropic()

export interface VisualHealResult {
  selector: string
  confidence: number
  reasoning: string
}

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

  const prompt = `A Playwright test tried to perform "${action}" but this locator broke: "${brokenSelector}"

Look at the screenshot and find the element this selector was targeting.

Return ONLY a JSON object:
{
  "selector": "best Playwright selector for this element",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence"
}

Prefer: [data-testid] > [aria-label] > button:has-text() > input[name] > text= > CSS`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') },
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

let _store: LocatorStore | null = null

export function getStore(): LocatorStore {
  if (!_store) _store = new LocatorStore()
  return _store
}
