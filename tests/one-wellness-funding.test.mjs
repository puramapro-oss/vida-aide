import assert from 'node:assert/strict'
import test from 'node:test'
import { isOneWellnessFundingAvailable, ONE_WELLNESS_FUNDING_URL } from '../src/lib/one-wellness-funding.ts'

const page = '<head><title>Aides au bien-être et à l’alimentation | PURAMA ONE</title></head>'
const reply = (body, status = 200, contentType = 'text/html; charset=utf-8') =>
  new Response(body, { status, headers: { 'content-type': contentType } })

test('an undeclared destination is hidden without requesting any remote data', async () => {
  let calls = 0
  for (const value of [undefined, '', 'false', '1', 'yes']) {
    assert.equal(await isOneWellnessFundingAvailable(value, () => { calls++; throw Error('must not request') }), false)
  }
  assert.equal(calls, 0)
})

test('an actual ONE health-funding page is recognized; the public request carries no client or patient data', async () => {
  assert.equal(await isOneWellnessFundingAvailable('true', async (url, init) => {
    assert.equal(url, 'https://purama.dev/revenus/financement/aides-bien-etre')
    assert.equal(url, ONE_WELLNESS_FUNDING_URL)
    assert.equal(init.credentials, 'omit')
    assert.equal(init.referrerPolicy, 'no-referrer')
    assert.equal(init.redirect, 'error')
    assert.deepEqual(init.headers, { Accept: 'text/html' })
    return reply(page)
  }), true)
})

test('a redirection, error page, JSON, unavailable server or timeout keeps the destination hidden', async () => {
  for (const fetcher of [() => reply(page, 404), () => reply(page, 302), () => reply(page, 200, 'application/json'),
    () => reply('<head><title>PURAMA</title></head>'), () => new Response(null, { status: 204 }),
    () => { throw new DOMException('timeout', 'TimeoutError') }]) {
    assert.equal(await isOneWellnessFundingAvailable('true', fetcher), false)
  }
})

test('split UTF-8 chunks, a page body without correct head, and the response size boundary', async () => {
  const bytes = new TextEncoder().encode(page)
  assert.equal(await isOneWellnessFundingAvailable('true', () => reply(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() }
  }))), true)
  assert.equal(await isOneWellnessFundingAvailable('true', () => reply('<head></head><body>' + page)), false)
  assert.equal(await isOneWellnessFundingAvailable('true', () => reply(' '.repeat(65536) + page)), false)
})
