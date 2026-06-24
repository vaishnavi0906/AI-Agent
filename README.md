# ai-self-heal-engine

Self-healing locator engine for Playwright. When a locator fails, it takes a screenshot, sends it to Claude, gets a working selector back, and retries — automatically.

## Install

```bash
npm install ai-self-heal-engine
```

## Setup

Add one line to your `playwright.config.ts`:

```ts
import 'ai-self-heal-engine/patch'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  // your existing config unchanged
})
```

That's it. Every test in your project now has a Plan B.

## How it works

```
locator.click() fails
        │
        ▼
Element not found?
        │
        ▼
Check cache  ──── hit ──▶  retry with cached selector ──▶ ✓
        │
       miss
        │
        ▼
Take screenshot
        │
        ▼
Claude looks at the page, finds the element
        │
        ▼
Retry with healed selector ──▶ ✓
        │
        ▼
Save to cache (next run is instant)
```

## Your tests don't change

```ts
// plain @playwright/test — no imports to change
import { test, expect } from '@playwright/test'

test('login', async ({ page }) => {
  await page.goto('https://example.com/login')

  // these selectors broke after a UI update
  await page.locator('#username-old').fill('user@example.com')
  await page.locator('#submit-old').click()

  // engine heals them silently, test passes ✓
})
```

## Options

```ts
import { installPatch } from 'ai-self-heal-engine'

installPatch({
  confidenceThreshold: 0.7,  // min Claude confidence to accept (default: 0.5)
  verbose: false,             // suppress heal logs (default: true)
  disabled: false,            // turn off Plan B entirely (default: false)
})
```

## Requirements

- Node.js 20+
- `ANTHROPIC_API_KEY` set in your environment
- `@playwright/test` >= 1.40

## Cache

Healed selectors are stored in `.self-heal/locators.db` (SQLite). Add to `.gitignore` or commit it to share healed selectors across your team.

## License

MIT
