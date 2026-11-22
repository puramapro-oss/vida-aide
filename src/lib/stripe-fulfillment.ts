import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { z } from 'zod'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'

const id = z.string().min(1).max(255)
const subscriptionSchema = z.object({
  id, customer_id: id,
  status: z.enum(['active', 'trialing', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'paused']),
  interval: z.enum(['monthly', 'yearly']),
  trial_ends_at: z.string().datetime().nullable(),
  previous_id: id.nullable(),
  previous_status: z.enum(['canceled', 'incomplete_expired']).nullable(),
})
const checkoutSchema = z.object({
  id, created: z.number().int().nonnegative().safe(), customer_id: id, email: z.string().email().max(320).nullable(),
  subscription_id: id.nullable(), payment_id: id.nullable(),
  mode: z.enum(['subscription', 'payment']),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  amount_total: z.number().int().min(0).max(999_999_999_999),
  currency: z.string().regex(/^[a-z]{3}$/),
  referral_code: z.string().min(1).max(40).nullable(),
})
const receiptSchema = z.object({
  version: z.literal(1), event_id: id, event_type: id, object_id: id,
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['applied', 'deferred', 'ignored']), duplicate: z.boolean(),
  profile_id: z.string().uuid().nullable(),
  payment_id: z.string().uuid().nullable(),
  wallet_transaction_id: z.string().uuid().nullable(),
})
const targetSchema = z.object({
  id: z.string().uuid(), stripe_customer_id: id.nullable(), stripe_subscription_id: id.nullable(),
  stripe_state_revision: z.number().int().nonnegative().safe(),
})

function objectId(value: string | { id: string } | null): string | null {
  return typeof value === 'string' ? value : value?.id ?? null
}

function hasInternalSecret(req: Request): boolean {
  const expected = process.env.INTERNAL_WEBHOOK_SECRET
  const supplied = req.headers.get('x-internal-secret')
  if (!expected || !supplied) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}

function normalizeSubscription(sub: Stripe.Subscription) {
  const interval = sub.items.data[0]?.price.recurring?.interval
  if (interval !== 'month' && interval !== 'year') throw new Error('Unsupported subscription interval')
  return subscriptionSchema.parse({
    id: sub.id, customer_id: objectId(sub.customer), status: sub.status,
    interval: interval === 'year' ? 'yearly' : 'monthly',
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    previous_id: null, previous_status: null,
  })
}

/** Both transports use the same durable transaction and the same event/session keys.
 * A verified Stripe signature authorizes parsing; only the SQL receipt authorizes 2xx.
 */
export async function handleStripeFulfillmentRequest(req: Request, internal: boolean) {
  if (internal && !hasInternalSecret(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  const signature = req.headers.get(internal ? 'x-stripe-signature' : 'stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !secret) {
    return NextResponse.json({ error: 'Webhook non configuré' }, { status: 400 })
  }

  let raw: string
  let event: Stripe.Event
  try {
    raw = await req.text()
    event = getStripe().webhooks.constructEvent(raw, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Signature ou événement invalide' }, { status: 400 })
  }

  const isCheckout = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded'
  const isSubscription = event.type === 'customer.subscription.created'
    || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted'
  if (!isCheckout && !isSubscription) {
    return NextResponse.json({ received: true, ignored: true })
  }

  try {
    const stripe = getStripe()
    const eventId = id.parse(event.id)
    const original = event.data.object as Stripe.Checkout.Session | Stripe.Subscription
    const originalId = id.parse(original.id)
    // This account also serves other PURAMA apps. Their events cannot mutate Aide.
    if (original.metadata?.app_slug !== 'vida-aide') {
      return NextResponse.json({ received: true, ignored: true })
    }
    const created = z.number().int().nonnegative().safe().parse(event.created)
    const payloadHash = createHash('sha256').update(raw).digest('hex')
    const customerId = id.parse(objectId(original.customer))
    const explicitProfile = original.metadata?.profile_id
      ? z.string().uuid().parse(original.metadata.profile_id) : null
    const service = createServiceClient()
    // Read BEFORE Stripe. The SQL transaction rejects a snapshot whose profile
    // revision changed during provider retrieval, so an old reader cannot win.
    const query = service.from('profiles')
      .select('id,stripe_customer_id,stripe_subscription_id,stripe_state_revision')
    const { data: targetData, error: targetError } = await (explicitProfile
      ? query.eq('id', explicitProfile) : query.eq('stripe_customer_id', customerId)).maybeSingle()
    if (targetError) throw new Error('Target lookup failed')
    const target = targetSchema.parse(targetData)
    if ((target.stripe_customer_id && target.stripe_customer_id !== customerId)
      || (!target.stripe_customer_id && !explicitProfile)) throw new Error('Target identity mismatch')
    let checkout: z.infer<typeof checkoutSchema> | null = null
    let subscription: z.infer<typeof subscriptionSchema> | null = null

    if (isCheckout) {
      // Read current state: completed is also delivered for delayed, unpaid checkouts.
      const session = await stripe.checkout.sessions.retrieve(originalId)
      if (session.id !== originalId || session.metadata?.app_slug !== 'vida-aide') {
        throw new Error('Checkout identity mismatch')
      }
      checkout = checkoutSchema.parse({
        id: session.id, created: session.created, customer_id: objectId(session.customer),
        email: session.customer_email ?? session.customer_details?.email ?? null,
        subscription_id: objectId(session.subscription), payment_id: objectId(session.payment_intent),
        mode: session.mode, payment_status: session.payment_status,
        amount_total: session.amount_total, currency: session.currency,
        referral_code: session.metadata?.referral_code || null,
      })
      if (checkout.customer_id !== customerId) throw new Error('Checkout customer changed')
      if (event.type === 'checkout.session.async_payment_succeeded' && checkout.payment_status !== 'paid') {
        throw new Error('Payment is not confirmed')
      }
      if (checkout.mode === 'subscription' && checkout.payment_status !== 'unpaid') {
        if (!checkout.subscription_id) throw new Error('Missing subscription')
        const sub = await stripe.subscriptions.retrieve(checkout.subscription_id)
        if (sub.id !== checkout.subscription_id || sub.metadata?.app_slug !== 'vida-aide') {
          throw new Error('Subscription identity mismatch')
        }
        subscription = normalizeSubscription(sub)
        if (subscription.customer_id !== checkout.customer_id) throw new Error('Customer identity mismatch')
        if (target.stripe_subscription_id && target.stripe_subscription_id !== subscription.id) {
          const previous = await stripe.subscriptions.retrieve(target.stripe_subscription_id)
          if (previous.id !== target.stripe_subscription_id || objectId(previous.customer) !== customerId
            || previous.metadata?.app_slug !== 'vida-aide'
            || (previous.status !== 'canceled' && previous.status !== 'incomplete_expired')) {
            throw new Error('Existing subscription requires reconciliation')
          }
          subscription.previous_id = previous.id
          subscription.previous_status = previous.status
        }
      }
    } else {
      // A late snapshot must not blindly restore an earlier subscription state.
      const sub = await stripe.subscriptions.retrieve(originalId)
      if (sub.id !== originalId || sub.metadata?.app_slug !== 'vida-aide') {
        throw new Error('Subscription identity mismatch')
      }
      subscription = normalizeSubscription(sub)
      if (subscription.customer_id !== customerId) throw new Error('Subscription customer changed')
    }

    const { data, error } = await service.rpc('apply_stripe_fulfillment', {
      p_event_id: eventId, p_event_type: event.type, p_object_id: originalId,
      p_payload_hash: payloadHash, p_event_created: created,
      p_profile_id: target.id, p_expected_revision: target.stripe_state_revision,
      p_checkout: checkout, p_subscription: subscription,
    })
    if (error) throw new Error('Persistence failed')
    const receipt = receiptSchema.parse(data)
    if (receipt.event_id !== eventId || receipt.event_type !== event.type
      || receipt.object_id !== originalId || receipt.payload_hash !== payloadHash
      || ((receipt.status === 'applied' || receipt.status === 'ignored') && receipt.profile_id !== target.id)
      || (receipt.status === 'applied' && checkout?.payment_status === 'paid' && checkout.amount_total > 0 && !receipt.payment_id)
      || (receipt.status === 'deferred' && (!isCheckout || event.type === 'checkout.session.async_payment_succeeded'
        || receipt.profile_id || receipt.payment_id || receipt.wallet_transaction_id))
      || (!receipt.duplicate && receipt.status === 'deferred' && checkout?.payment_status !== 'unpaid')
      || (!receipt.duplicate && receipt.status === 'applied' && checkout?.payment_status === 'unpaid')) {
      throw new Error('Persistence receipt mismatch')
    }
    if (receipt.status === 'ignored' && (isCheckout || !receipt.profile_id || receipt.payment_id || receipt.wallet_transaction_id)) {
      throw new Error('Ignored receipt mismatch')
    }
    return NextResponse.json({ received: true, duplicate: receipt.duplicate, deferred: receipt.status === 'deferred',
      ...(receipt.status === 'ignored' ? { ignored: true } : {}) })
  } catch {
    // No provider, customer, SQL or secret detail is returned to either transport.
    // A failed/ambiguous write must remain retryable; it is never acknowledged as done.
    return NextResponse.json({ error: 'Traitement du paiement non confirmé' }, { status: 500 })
  }
}
