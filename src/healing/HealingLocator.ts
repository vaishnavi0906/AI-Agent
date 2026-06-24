import type { Page, Locator, FrameLocator } from '@playwright/test'
import { HealingEngine, resolveLocator, type HealingEngineOptions } from './HealingEngine.js'
import type { LocatorType } from './LocatorStore.js'

/**
 * HealingLocator wraps a Playwright Locator transparently.
 * On action failure it triggers the HealingEngine to find a working replacement,
 * then retries the action with the healed locator — no test code changes needed.
 */
export class HealingLocator {
  private page: Page
  private selector: string
  private engine: HealingEngine

  constructor(page: Page, selector: string, engine: HealingEngine) {
    this.page = page
    this.selector = selector
    this.engine = engine
  }

  // ── Internal: resolve current best locator ─────────────────────────────
  private raw(): Locator {
    return this.page.locator(this.selector)
  }

  /**
   * Runs an action. If the action throws, attempts healing and retries once.
   */
  private async withHealing<T>(action: (loc: Locator) => Promise<T>): Promise<T> {
    try {
      return await action(this.raw())
    } catch (primaryError) {
      const result = await this.engine.heal(this.page, this.selector)

      if (!result.healed) throw primaryError

      const healed = resolveLocator(
        this.page,
        result.selector,
        result.locator_type as LocatorType,
        result.role_name,
      )

      try {
        return await action(healed)
      } catch {
        // Healed locator also failed — throw the original error for clarity
        throw primaryError
      }
    }
  }

  // ── Action methods ────────────────────────────────────────────────────

  async click(options?: Parameters<Locator['click']>[0]): Promise<void> {
    return this.withHealing(loc => loc.click(options))
  }

  async fill(value: string, options?: Parameters<Locator['fill']>[1]): Promise<void> {
    return this.withHealing(loc => loc.fill(value, options))
  }

  async type(text: string, options?: Parameters<Locator['type']>[1]): Promise<void> {
    return this.withHealing(loc => loc.type(text, options))
  }

  async press(key: string, options?: Parameters<Locator['press']>[1]): Promise<void> {
    return this.withHealing(loc => loc.press(key, options))
  }

  async check(options?: Parameters<Locator['check']>[0]): Promise<void> {
    return this.withHealing(loc => loc.check(options))
  }

  async uncheck(options?: Parameters<Locator['uncheck']>[0]): Promise<void> {
    return this.withHealing(loc => loc.uncheck(options))
  }

  async selectOption(
    values: Parameters<Locator['selectOption']>[0],
    options?: Parameters<Locator['selectOption']>[1],
  ): Promise<string[]> {
    return this.withHealing(loc => loc.selectOption(values, options))
  }

  async hover(options?: Parameters<Locator['hover']>[0]): Promise<void> {
    return this.withHealing(loc => loc.hover(options))
  }

  async tap(options?: Parameters<Locator['tap']>[0]): Promise<void> {
    return this.withHealing(loc => loc.tap(options))
  }

  async focus(options?: Parameters<Locator['focus']>[0]): Promise<void> {
    return this.withHealing(loc => loc.focus(options))
  }

  async blur(options?: Parameters<Locator['blur']>[0]): Promise<void> {
    return this.withHealing(loc => loc.blur(options))
  }

  async clear(options?: Parameters<Locator['clear']>[0]): Promise<void> {
    return this.withHealing(loc => loc.clear(options))
  }

  async scrollIntoViewIfNeeded(options?: Parameters<Locator['scrollIntoViewIfNeeded']>[0]): Promise<void> {
    return this.withHealing(loc => loc.scrollIntoViewIfNeeded(options))
  }

  async waitFor(options?: Parameters<Locator['waitFor']>[0]): Promise<void> {
    return this.withHealing(loc => loc.waitFor(options))
  }

  // ── Read methods ──────────────────────────────────────────────────────

  async textContent(options?: Parameters<Locator['textContent']>[0]): Promise<string | null> {
    return this.withHealing(loc => loc.textContent(options))
  }

  async innerText(options?: Parameters<Locator['innerText']>[0]): Promise<string> {
    return this.withHealing(loc => loc.innerText(options))
  }

  async innerHTML(options?: Parameters<Locator['innerHTML']>[0]): Promise<string> {
    return this.withHealing(loc => loc.innerHTML(options))
  }

  async inputValue(options?: Parameters<Locator['inputValue']>[0]): Promise<string> {
    return this.withHealing(loc => loc.inputValue(options))
  }

  async getAttribute(name: string, options?: Parameters<Locator['getAttribute']>[1]): Promise<string | null> {
    return this.withHealing(loc => loc.getAttribute(name, options))
  }

  async isVisible(options?: Parameters<Locator['isVisible']>[0]): Promise<boolean> {
    return this.withHealing(loc => loc.isVisible(options))
  }

  async isHidden(options?: Parameters<Locator['isHidden']>[0]): Promise<boolean> {
    return this.withHealing(loc => loc.isHidden(options))
  }

  async isEnabled(options?: Parameters<Locator['isEnabled']>[0]): Promise<boolean> {
    return this.withHealing(loc => loc.isEnabled(options))
  }

  async isDisabled(options?: Parameters<Locator['isDisabled']>[0]): Promise<boolean> {
    return this.withHealing(loc => loc.isDisabled(options))
  }

  async isChecked(options?: Parameters<Locator['isChecked']>[0]): Promise<boolean> {
    return this.withHealing(loc => loc.isChecked(options))
  }

  async isEditable(options?: Parameters<Locator['isEditable']>[0]): Promise<boolean> {
    return this.withHealing(loc => loc.isEditable(options))
  }

  async count(): Promise<number> {
    return this.raw().count()
  }

  async screenshot(options?: Parameters<Locator['screenshot']>[0]): Promise<Buffer> {
    return this.withHealing(loc => loc.screenshot(options))
  }

  /** Returns the underlying Playwright Locator (no healing). */
  asLocator(): Locator {
    return this.raw()
  }
}

// ── Proxy-based page wrapper ────────────────────────────────────────────────

/**
 * Wraps a Playwright Page so that every page.locator() call returns
 * a HealingLocator. All other Page methods pass through unchanged.
 */
export function createHealingPage(page: Page, engine: HealingEngine): Page {
  return new Proxy(page, {
    get(target, prop) {
      if (prop === 'locator') {
        return (selector: string, options?: Parameters<Page['locator']>[1]) => {
          // If caller passes options (filter, has, etc.) fall through to native
          if (options) return target.locator(selector, options)
          return new HealingLocator(page, selector, engine)
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Convenience factory: create a one-off HealingLocator without a full fixture. */
export function heal(page: Page, selector: string, options?: HealingEngineOptions): HealingLocator {
  const engine = new HealingEngine(options)
  return new HealingLocator(page, selector, engine)
}
