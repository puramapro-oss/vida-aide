import { test, expect } from '@playwright/test'

const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const

const PUBLIC_ROUTES = [
  '/',
  '/pricing',
  '/how-it-works',
  '/associations',
  '/aide',
  '/login',
  '/signup',
  '/mentions-legales',
  '/cgu',
] as const

const FORBIDDEN = [
  'Restos du Cœur',
  'WWF',
  'Croix-Rouge',
  'Amnesty',
  'UNICEF',
  'Unicef',
  'Médecins Sans Frontières',
  'MSF',
  'Greenpeace',
  '15+ associations',
  '42 catégories',
]

test.describe('Responsive — 4 viewports × public routes', () => {
  for (const vp of VIEWPORTS) {
    for (const route of PUBLIC_ROUTES) {
      test(`${vp.name} ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        const resp = await page.goto(route, { waitUntil: 'domcontentloaded' })
        expect(resp?.status(), `${route} status`).toBeLessThan(400)

        // No horizontal overflow on the visible scroll surface (html element).
        // Body may report inflated scroll due to absolutely-positioned blur orbs
        // which are visually clipped via overflow-x: clip — that's expected.
        const overflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth - window.innerWidth
        })
        expect(overflow, `horizontal overflow on ${route} @${vp.width}px`).toBeLessThanOrEqual(2)

        // No fake org names anywhere
        const html = await page.content()
        for (const f of FORBIDDEN) {
          expect(html.includes(f), `forbidden token "${f}" leaked on ${route}`).toBeFalsy()
        }

        // Brand check: PURAMA should appear on landing
        if (route === '/') {
          expect(html.includes('PURAMA')).toBeTruthy()
        }
      })
    }
  }
})

test('No fake numbers in /', async ({ page }) => {
  await page.goto('/')
  const html = await page.content()
  expect(html).not.toMatch(/15\+\s*associations/i)
  expect(html).not.toMatch(/42\s*cat[ée]gories/i)
})
