import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Connexion — PURAMA Aide',
  description:
    'Connecte-toi à PURAMA Aide : scanner financier, démarches automatiques, wallet IBAN, alertes droits. Email ou Google, session 30 jours.',
  alternates: { canonical: 'https://vida-aide.purama.dev/login' },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
