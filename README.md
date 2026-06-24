# 🔬 AI Test Engineer — Self-Healing Locator Engine

> Playwright locators that **automatically heal themselves** when the UI changes, powered by Claude AI.

When a selector breaks (element moved, ID renamed, class changed), the engine:
1. Tries ARIA/role/testid fallbacks _(free, instant)_
2. Tries fuzzy text matching _(free, instant)_
3. Tries structural DOM heuristics _(free, instant)_
4. Asks Claude to analyze the DOM + screenshot and find the element _(LLM, last resort)_
5. **Persists the healed selector** to SQLite so the next run is instant

Tests keep running. No manual selector fixes needed.

---

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/ai-test-engineer
cd ai-test-engineer
npm install
npx playwright install chromium
export ANTHROPIC_API_KEY=sk-ant-...
npm test
```

---

## Usage

Import `test` from the fixture instead of `@playwright/test`:

```ts
import { test, expect } from './src/fixture.js'

test('login flow', async ({ page, healPage }) => {
  await healPage.goto('https://myapp.com/login')

  // These selectors auto-heal if they break after a UI change
  await healPage.locator('#username-input').fill('user@example.com')
  await healPage.locator('#password-field').fill('secret')
  await healPage.locator('.btn-primary-submit').click()

  // Use native page for assertions
  await expect(page.locator('.dashboard')).toBeVisible()
})
```

### Configure healing behaviour

```ts
test.use({
  healingOptions: {
    skipLLM: true,              // heuristics only, no API cost
    llmWithScreenshot: true,    // give Claude visual context (default: true)
    llmConfidenceThreshold: 0.7, // minimum confidence to accept LLM suggestion
    verbose: false,             // suppress heal logs
    dbPath: '.healing/locators.db', // where to store healed locators
  },
})
```

### One-off healing (no fixture)

```ts
import { heal } from './src/index.js'

// wrap a single locator
const btn = heal(page, '#broken-submit-btn')
await btn.click()
```

---

## How It Works

```
Locator action fails
        │
        ▼
┌───────────────────┐
│  1. Check cache   │ ← SQLite (healed before? reuse it)
└────────┬──────────┘
         │ miss
         ▼
┌───────────────────┐
│  2. ARIA / Role   │ ← getByRole, getByTestId, getByLabel
└────────┬──────────┘
         │ no match
         ▼
┌───────────────────┐
│  3. Fuzzy text    │ ← getByText, getByPlaceholder
└────────┬──────────┘
         │ no match
         ▼
┌───────────────────┐
│  4. Structural    │ ← tag + class heuristics
└────────┬──────────┘
         │ no match
         ▼
┌───────────────────┐
│  5. Claude LLM    │ ← DOM snapshot + screenshot → best selector
└────────┬──────────┘
         │
         ▼
  Persist to SQLite → retry action → test continues ✓
```

---

## GitHub Actions CI

The included workflow (`.github/workflows/test.yml`):
- Runs on every push, PR, and nightly at 2am UTC
- Caches the healing DB across runs (healed locators survive between jobs)
- Uploads Playwright HTML report as an artifact
- **Files a GitHub Issue automatically** when tests fail on `main`

Add your key to repo secrets: `Settings → Secrets → ANTHROPIC_API_KEY`

---

## Project Structure

```
src/
  healing/
    LocatorStore.ts          SQLite persistence (heal history, stats)
    HealingEngine.ts         Strategy orchestrator
    HealingLocator.ts        Playwright action proxy + page wrapper
    strategies/
      heuristic.ts           ARIA, text, structural strategies
      llm.ts                 Claude (DOM + screenshot) strategy
  fixture.ts                 Playwright test fixture
  index.ts                   Public API

tests/
  healing.spec.ts            Demo tests

.github/workflows/
  test.yml                   CI pipeline
```

---

## Healing Stats

After a test run, check what was healed:

```ts
test('stats', async ({ healingEngine }) => {
  console.table(healingEngine.getStore().stats())
  // strategy | count | avg_confidence | avg_heals
  // aria     |   12  |     0.90       |    1.2
  // llm      |    3  |     0.82       |    1.0
})
```

---

## Requirements

- Node.js 20+
- `ANTHROPIC_API_KEY` (only needed if `skipLLM` is not set)

## License

MIT
