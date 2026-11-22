import { handleStripeFulfillmentRequest } from '@/lib/stripe-fulfillment'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  return handleStripeFulfillmentRequest(req, true)
}
