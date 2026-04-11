import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/api/', '/auth/', '/(auth)/'],
    },
    sitemap: 'https://vida-aide.purama.dev/sitemap.xml',
  }
}
