import type { Page, Locator } from '@playwright/test'
import { LocatorStore, type LocatorType } from './LocatorStore.js'
import { ariaStrategy, textStrategy, structuralStrategy, type StrategyResult } from './strategies/heuristic.js'
import { llmStrategy } from './strategies/llm.js'

export interface HealResult {
  healed: boolean
  selector: string
  locator_type: LocatorType
  role_name?: string
  strategy: string
  confidence: number
  durationMs: number
}

export interface HealingEngineOptions {
  /** Path to the SQLite database. Default: .healing/locators.db */
  dbPath?: string
  /** Minimum confidence from LLM to accept its suggestion. Default: 0.6 */
  llmConfidenceThreshold?: number
  /** Send screenshot to LLM for visual context. Default: true */
  llmWithScreenshot?: boolean
  /** Skip LLM entirely (use only heuristics). Default: false */
  skipLLM?: boolean
  /** Log healing activity to console. Default: true */
  verbose?: boolean
}

/**
 * Resolves a stored healed record into a live Playwright Locator.
 */
export function resolveLocator(
  page: Page,
  selector: string,
  locatorType: LocatorType,
  roleName?: string | null,
): Locator {
  switch (locatorType) {
    case 'testid':    return page.getByTestId(selector)
    case 'label':     return page.getByLabel(selector, { exact: false })
    case 'text':      return page.getByText(selector, { exact: false })
    case 'placeholder': return page.getByPlaceholder(selector, { exact: false })
    case 'role':      return page.getByRole(selector as Parameters<Page['getByRole']>[0], roleName ? { name: roleName, exact: false } : {})
    case 'css':
    case 'llm':
    default:          return page.locator(selector)
  }
}

export class HealingEngine {
  private store: LocatorStore
  private opts: Required<HealingEngineOptions>

  constructor(options: HealingEngineOptions = {}) {
    this.opts = {
      dbPath: options.dbPath ?? '.healing/locators.db',
      llmConfidenceThreshold: options.llmConfidenceThreshold ?? 0.6,
      llmWithScreenshot: options.llmWithScreenshot ?? true,
      skipLLM: options.skipLLM ?? false,
      verbose: options.verbose ?? true,
    }
    this.store = new LocatorStore(this.opts.dbPath)
  }

  /**
   * Attempt to heal a broken selector.
   * Returns a HealResult with the best candidate found, or healed=false if nothing worked.
   */
  async heal(page: Page, originalSelector: string): Promise<HealResult> {
    const startMs = Date.now()
    const pageUrl = page.url()

    // ── Step 1: Check persisted store ──────────────────────────────────────
    const cached = this.store.get(originalSelector, pageUrl)
    if (cached) {
      const loc = resolveLocator(page, cached.healed_selector, cached.locator_type as LocatorType, cached.role_name)
      const count = await loc.count()
      if (count > 0) {
        this.log(`✓ cache hit: "${originalSelector}" → "${cached.healed_selector}" (${cached.strategy})`)
        return this.makeResult(true, cached.healed_selector, cached.locator_type as LocatorType, cached.role_name ?? undefined, 'cached', cached.confidence, startMs)
      }
      this.log(`⚠ cached locator stale, re-healing: "${originalSelector}"`)
    }

    // ── Step 2: Heuristic strategies (no LLM cost) ────────────────────────
    const heuristicStrategies: Array<{ name: string; fn: () => Promise<StrategyResult | null> }> = [
      { name: 'aria',       fn: () => ariaStrategy(page, originalSelector) },
      { name: 'text',       fn: () => textStrategy(page, originalSelector) },
      { name: 'structural', fn: () => structuralStrategy(page, originalSelector) },
    ]

    for (const { name, fn } of heuristicStrategies) {
      const result = await fn()
      if (result) {
        // Verify the candidate actually resolves to exactly one element
        const loc = resolveLocator(page, result.selector, result.locator_type, result.role_name)
        const count = await loc.count()
        if (count === 1) {
          this.persist(originalSelector, pageUrl, result, name)
          this.log(`✓ healed via ${name}: "${originalSelector}" → "${result.selector}" (conf ${result.confidence})`)
          return this.makeResult(true, result.selector, result.locator_type, result.role_name, name, result.confidence, startMs)
        }
      }
    }

    // ── Step 3: LLM strategy ──────────────────────────────────────────────
    if (!this.opts.skipLLM) {
      this.log(`🤖 invoking LLM for "${originalSelector}"...`)
      const result = await llmStrategy(page, originalSelector, this.opts.llmWithScreenshot)

      if (result && result.confidence >= this.opts.llmConfidenceThreshold) {
        const loc = resolveLocator(page, result.selector, result.locator_type, result.role_name)
        const count = await loc.count()
        if (count >= 1) {
          this.persist(originalSelector, pageUrl, result, 'llm')
          this.log(`✓ healed via LLM: "${originalSelector}" → "${result.selector}" (conf ${result.confidence})`)
          return this.makeResult(true, result.selector, result.locator_type, result.role_name, 'llm', result.confidence, startMs)
        }
      }
    }

    // ── Step 4: Healing failed ────────────────────────────────────────────
    this.log(`✗ could not heal "${originalSelector}"`)
    return this.makeResult(false, originalSelector, 'css', undefined, 'none', 0, startMs)
  }

  getStore(): LocatorStore {
    return this.store
  }

  private persist(
    original: string,
    pageUrl: string,
    result: StrategyResult,
    strategy: string,
  ) {
    this.store.upsert({
      original,
      healed_selector: result.selector,
      locator_type: result.locator_type,
      role_name: result.role_name,
      strategy,
      page_url: pageUrl,
      confidence: result.confidence,
    })
  }

  private makeResult(
    healed: boolean,
    selector: string,
    locatorType: LocatorType,
    roleName: string | undefined,
    strategy: string,
    confidence: number,
    startMs: number,
  ): HealResult {
    return { healed, selector, locator_type: locatorType, role_name: roleName, strategy, confidence, durationMs: Date.now() - startMs }
  }

  private log(msg: string) {
    if (this.opts.verbose) console.log(`[HealingEngine] ${msg}`)
  }
}
