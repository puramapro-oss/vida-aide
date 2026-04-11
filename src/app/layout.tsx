import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from 'sonner'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import CookieBanner from '@/components/shared/CookieBanner'
import CursorGlow from '@/components/layout/CursorGlow'
import FloatingLeaves from '@/components/layout/FloatingLeaves'
import SkipToContent from '@/components/shared/SkipToContent'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "PURAMA Aide — Récupère tout l'argent qui te revient",
  description: "Aides, remboursements, droits oubliés, optimisation fiscale. AideIA scanne ta situation en 2 minutes et lance les démarches pour toi.",
  metadataBase: new URL('https://vida-aide.purama.dev'),
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: "PURAMA Aide — L'argent que tu laisses sur la table",
    description: 'Aides sociales, optimisation fiscale, argent oublié, droits du travail. AideIA fait les démarches pour toi.',
    url: 'https://vida-aide.purama.dev',
    siteName: 'PURAMA Aide',
    locale: 'fr_FR',
    type: 'website',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'PURAMA Aide — récupère ce qui te revient',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PURAMA Aide',
    description: "Récupère tout l'argent que tu laisses sur la table.",
    images: ['/api/og'],
  },
  robots: { index: true, follow: true },
  alternates: {
    canonical: 'https://vida-aide.purama.dev',
  },
}

export const viewport: Viewport = {
  themeColor: '#10B981',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('vida-aide-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}else{document.documentElement.dataset.theme='dark'}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--bg-void)] font-[family-name:var(--font-body)] text-[var(--text-primary)] antialiased">
        <SkipToContent />
        <div className="aurora" />
        <div className="grid-overlay" />
        <div className="noise-overlay" />
        <FloatingLeaves />
        <CursorGlow />
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ErrorBoundary>
            <div id="main-content" tabIndex={-1} className="outline-none">
              {children}
            </div>
          </ErrorBoundary>
          <CookieBanner />
        </NextIntlClientProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(255,255,255,0.05)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: '#f0f2ff',
            },
          }}
        />
      </body>
    </html>
  )
}
