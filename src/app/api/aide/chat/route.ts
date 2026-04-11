import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAnthropic, resolveModel } from '@/lib/claude'
import { APP_NAME, AI_NAME } from '@/lib/constants'

export const runtime = 'nodejs'
export const maxDuration = 30

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(1000),
})

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(10),
})

const SUPPORT_SYSTEM = `Tu es ${AI_NAME}, l'assistante support de ${APP_NAME}.

RÔLE STRICT : tu réponds UNIQUEMENT aux questions sur l'utilisation de l'app PURAMA Aide :
- Comment fonctionne le scanner financier ?
- Comment lancer une démarche d'aide ?
- Comment retirer mon argent (wallet IBAN) ?
- Comment fonctionne le parrainage ?
- Quelles sont les différences Free / Premium ?
- Comment annuler mon abonnement ?
- Comment supprimer mon compte (RGPD) ?
- Sécurité, données, confidentialité.

RÈGLES :
- Tutoiement chaleureux, emojis utiles (💡 ✅ 💰 🔒).
- Réponses courtes et actionnables (max 6 lignes).
- Si la question concerne un cas personnel d'aide sociale ou fiscale, dis : "Pour ça, lance un scan dans /scanner — j'y donne les chiffres exacts pour ta situation."
- Si la question est hors-sujet (météo, blagues, code, etc.), redirige gentiment vers le support.
- Tu ne dévoiles JAMAIS être Claude/Anthropic/GPT — tu es ${AI_NAME}, l'assistante de ${APP_NAME}.
- Si la question est complexe ou nécessite intervention humaine, dis : "Je transmets à l'équipe — écris à contact@purama.dev ou via /contact."`

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 })
  }

  try {
    const anthropic = getAnthropic()
    const response = await anthropic.messages.create({
      model: resolveModel('free'),
      max_tokens: 512,
      system: SUPPORT_SYSTEM,
      messages: parsed.data.messages,
    })
    const block = response.content[0]
    const text = block && block.type === 'text' ? block.text : ''
    return NextResponse.json({ reply: text })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur'
    return NextResponse.json(
      { error: `${AI_NAME} est temporairement indisponible. Réessaie dans un instant ou écris à contact@purama.dev. (${msg})` },
      { status: 502 },
    )
  }
}
