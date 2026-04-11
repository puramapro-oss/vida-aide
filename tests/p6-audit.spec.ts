import { test, expect, type Page } from '@playwright/test'

// Runs against the live prod baseURL configured in playwright.config.ts
// (https://vida-assoc.purama.dev). These tests are read-only smoke checks:
// no auth, no data mutations.

function attachConsole(page: Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

function filterBenign(errors: string[]) {
  return errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      !e.includes('favicon') &&
      !e.includes('manifest') &&
      !e.includes('hydrat') &&
      !e.includes('Warning:') &&
      !e.includes('Supabase') &&
      !e.includes('ERR_') &&
      !e.includes('net::') &&
      !e.includes('ResizeObserver'),
  )
}

const PUBLIC_PAGES = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/pricing',
  '/how-it-works',
  '/ecosystem',
  '/aide',
  '/contact',
  '/associations',
  '/impact-global',
  '/rituels-publics',
  '/mentions-legales',
  '/politique-confidentialite',
  '/cgv',
  '/cgu',
]

test.describe('P6 — Public pages (200 + console 0)', () => {
  for (const path of PUBLIC_PAGES) {
    test(`GET ${path}`, async ({ page }) => {
      const errors = attachConsole(page)
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 })
      expect(res?.status(), `${path} status`).toBeLessThan(400)
      const real = filterBenign(errors)
      expect(real, `console errors on ${path}: ${real.join(' | ')}`).toHaveLength(0)
    })
  }
})

const DASHBOARD_PAGES = [
  '/dashboard',
  '/dashboard/missions',
  '/dashboard/dons',
  '/dashboard/associations',
  '/dashboard/impact',
  '/dashboard/chat-vida',
  '/dashboard/referral',
  '/dashboard/wallet',
  '/dashboard/concours',
  '/dashboard/rituels',
  '/dashboard/formations',
  '/dashboard/boutique',
  '/dashboard/profile',
  '/dashboard/settings',
  '/dashboard/notifications',
  '/dashboard/guide',
  '/dashboard/communaute',
  '/dashboard/influenceur',
  '/dashboard/admin',
]

test.describe('P6 — Dashboard auth guard (redirect → /login)', () => {
  for (const path of DASHBOARD_PAGES) {
    test(`GUARD ${path} → /login`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 })
      expect(page.url(), `${path} should redirect to /login`).toMatch(/\/login/)
    })
  }
})

test.describe('P6 — Responsive (no horizontal overflow)', () => {
  const viewports = [
    { label: 'iPhone SE 375', width: 375, height: 667 },
    { label: 'iPad 768', width: 768, height: 1024 },
    { label: 'Desktop 1920', width: 1920, height: 1080 },
  ]
  const pages = ['/', '/login', '/pricing', '/associations', '/impact-global']

  for (const vp of viewports) {
    for (const p of pages) {
      test(`${p} @ ${vp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 20000 })
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 2,
        )
        expect(overflow, `${p} overflows at ${vp.width}px`).toBe(false)
      })
    }
  }
})

test.describe('P6 — API routes', () => {
  test('GET /api/status → 200 + VIDA Association', async ({ request }) => {
    const res = await request.get('/api/status')
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.app).toBe('VIDA Association')
  })

  test('POST /api/chat-vida unauth → 401', async ({ request }) => {
    const res = await request.post('/api/chat-vida', {
      data: { messages: [{ role: 'user', content: 'hello' }] },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/wallet/withdraw unauth → 401', async ({ request }) => {
    const res = await request.post('/api/wallet/withdraw', {
      data: { amount_cents: 500, iban: 'FR7612345678901234567890123' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/rituals/join unauth → 401', async ({ request }) => {
    const res = await request.post('/api/rituals/join', { data: { ritual_id: 'x' } })
    expect(res.status()).toBe(401)
  })

  test('POST /api/locale → switch to EN', async ({ request }) => {
    const res = await request.post('/api/locale', { data: { locale: 'en' } })
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.locale).toBe('en')
  })

  test('POST /api/locale invalid → 400', async ({ request }) => {
    const res = await request.post('/api/locale', { data: { locale: 'xx' } })
    expect(res.status()).toBe(400)
  })

  test('GET /sitemap.xml → 200 + xml', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    expect((await res.text()).trim().startsWith('<?xml')).toBe(true)
  })

  test('GET /robots.txt → 200', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
  })

  test('GET /manifest.json → 200 + VIDA', async ({ request }) => {
    const res = await request.get('/manifest.json')
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.name).toBe('VIDA Association')
    expect(json.short_name).toBe('VIDA')
  })
})

test.describe('P6 — Forms', () => {
  test('Login — testIDs visible + typeable', async ({ page }) => {
    await page.goto('/login')
    const email = page.locator('[data-testid="email-input"]')
    const pass = page.locator('[data-testid="password-input"]')
    await expect(email).toBeVisible()
    await expect(pass).toBeVisible()
    await email.fill('test@test.com')
    await pass.fill('test1234')
    await expect(email).toHaveValue('test@test.com')
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="google-login"]')).toBeVisible()
  })

  test('Signup — all fields present', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.locator('[data-testid="name-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="confirm-password-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="cgu-checkbox"]')).toBeVisible()
    await expect(page.locator('[data-testid="signup-button"]')).toBeVisible()
  })

  test('Forgot password — form present', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.locator('[data-testid="forgot-email-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="forgot-submit"]')).toBeVisible()
  })
})

test.describe('P6 — Landing content', () => {
  test('Landing — VIDA branding + SASU PURAMA footer', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toContainText('VIDA')
    const footer = page.locator('footer')
    await expect(footer).toContainText('SASU PURAMA')
    await expect(footer).toContainText('293')
  })

  test('Landing — signup CTA exists', async ({ page }) => {
    await page.goto('/')
    const cta = page.locator('a[href="/signup"]').first()
    await expect(cta).toBeVisible()
  })

  test('Landing — no AKASHA leakage', async ({ page }) => {
    await page.goto('/')
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).not.toContain('akasha')
  })

  test('/associations — SEO title + listing', async ({ page }) => {
    await page.goto('/associations')
    await expect(page.locator('body')).toContainText('Association')
  })

  test('/impact-global — counters present', async ({ page }) => {
    await page.goto('/impact-global')
    await expect(page.locator('body')).toContainText('Impact')
  })
})
