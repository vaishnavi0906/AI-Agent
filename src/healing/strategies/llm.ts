import type { Page } from '@playwright/test'
import Anthropic from '@anthropic-ai/sdk'
import type { StrategyResult } from './heuristic.js'

const client = new Anthropic()

interface DomElement {
  tag: string
  id: string
  classes: string
  text: string
  role: string | null
  ariaLabel: string | null
  dataTestId: string | null
  name: string | null
  type: string | null
  placeholder: string | null
  href: string | null
}

interface LLMResponse {
  selector: string
  locator_type: 'css' | 'text' | 'role' | 'label' | 'placeholder' | 'testid'
  role_name?: string
  confidence: number
  reasoning: string
}

/**
 * Strategy 4 — LLM (Claude)
 * Serializes interactive DOM elements + optionally a screenshot,
 * asks Claude to identify the best replacement selector.
 */
export async function llmStrategy(
  page: Page,
  originalSelector: string,
  withScreenshot = true,
): Promise<StrategyResult | null> {
  // Snapshot interactive DOM — limited to 120 elements to stay within context
  const elements: DomElement[] = await page.evaluate(() => {
    const SELECTOR = [
      'button', 'a', 'input', 'select', 'textarea',
      '[role]', '[data-testid]', '[aria-label]', 'label',
      'h1', 'h2', 'h3', 'nav', 'form',
    ].join(',')

    return Array.from(document.querySelectorAll(SELECTOR))
      .slice(0, 120)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id ?? '',
        classes: el.className ?? '',
        text: (el.textContent ?? '').trim().slice(0, 60),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        dataTestId: el.getAttribute('data-testid'),
        name: el.getAttribute('name'),
        type: el.getAttribute('type'),
        placeholder: el.getAttribute('placeholder'),
        href: el.getAttribute('href'),
      }))
  })

  const systemPrompt = `You are a senior test automation engineer specialising in Playwright.
A locator has broken after a UI change. Your job is to find the best replacement selector.

Rules:
- Prefer: data-testid > aria role > aria label > visible text > CSS
- Return ONLY a single JSON object — no markdown fences, no explanation outside JSON
- The selector field must work with page.locator() or the appropriate Playwright method
- For role type, selector = the role string (e.g. "button"), role_name = accessible name
- Confidence: 0.0–1.0 (be honest; if unsure set < 0.7)`

  const userPrompt = `Broken selector: "${originalSelector}"

Interactive elements on the page (${elements.length} found):
${JSON.stringify(elements, null, 2)}

Return JSON matching this schema:
{
  "selector": string,
  "locator_type": "css" | "text" | "role" | "label" | "placeholder" | "testid",
  "role_name": string | undefined,
  "confidence": number,
  "reasoning": string
}`

  // Build message — add screenshot as first content block if requested
  const content: Anthropic.ContentBlockParam[] = []

  if (withScreenshot) {
    try {
      const screenshot = await page.screenshot({ type: 'png' })
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot.toString('base64'),
        },
      })
    } catch {
      // screenshot failed — continue without it
    }
  }

  content.push({ type: 'text', text: userPrompt })

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const parsed: LLMResponse = JSON.parse(text.trim())

    if (!parsed.selector || typeof parsed.confidence !== 'number') return null

    return {
      selector: parsed.selector,
      locator_type: parsed.locator_type,
      role_name: parsed.role_name,
      confidence: Math.min(Math.max(parsed.confidence, 0), 1),
    }
  } catch {
    return null
  }
}
