export const SUPER_ADMIN_EMAIL = 'matiss.frasne@gmail.com'

export const APP_NAME = 'PURAMA Aide'
export const APP_SHORT_NAME = 'AideIA'
export const APP_SLUG = 'vida-aide'
export const APP_DOMAIN = 'vida-aide.purama.dev'
export const APP_URL = 'https://vida-aide.purama.dev'
export const APP_COLOR = '#10B981'
export const APP_COLOR_SECONDARY = '#F59E0B'
export const APP_SCHEMA = 'vida_aide'
export const AI_NAME = 'AideIA'

export const COMPANY_INFO = {
  name: 'SASU PURAMA',
  address: '8 Rue de la Chapelle, 25560 Frasne',
  country: 'France',
  taxNote: 'TVA non applicable, art. 293 B du CGI',
  dpo: 'matiss.frasne@gmail.com',
  association: 'Association PURAMA (loi 1901)',
  founder: 'Matiss Dornier',
}

// Abonnement PURAMA Aide — 1 plan unique avec essai 14j
// Mensuel 9.99€ (-10% premier mois) | Annuel 83.90€ (-30%)
// Sans abo : browse only (peut tout voir, ne peut rien lancer)
export const PLANS = {
  free: {
    id: 'free',
    label: 'Découverte',
    price_monthly: 0,
    price_yearly: 0,
    features: [
      'Voir toutes les aides récupérables',
      'Diagnostic financier complet',
      'Accès au chat AideIA (3 questions/jour)',
      'Lecture seule : pas de lancement de démarches',
    ],
  },
  premium: {
    id: 'premium',
    label: 'PURAMA Aide Premium',
    price_monthly: 999, // 9.99€
    price_yearly: 8390, // 83.90€ (-30%)
    first_month_discount: 10, // -10% premier mois
    trial_days: 14,
    features: [
      'Essai gratuit 14 jours',
      'Lancement automatique des demandes d\'aides',
      'Optimisation fiscale illimitée + frontaliers (8 corridors)',
      'Argent oublié : Ciclade, assurances, trop-perçus',
      'Assistant juridique AideIA illimité',
      'Missions rémunérées + wallet retrait IBAN dès 5€',
      'x5 places aux jeux concours',
      'Cashback 5% boutique PURAMA',
      '14 jours essai gratuit, sans engagement',
    ],
    popular: true,
  },
} as const

export type PlanId = keyof typeof PLANS

export const VIDA_CREDIT_TO_EUR = 0.01
export const WALLET_MIN_WITHDRAWAL = 5 // euros
export const ASSO_PERCENTAGE = 10
export const REDISTRIBUTION_PERCENTAGE = 50

// Anti-fraude scans : free = 5 par 24h, premium = illimité
export const SCAN_DAILY_LIMIT_FREE = 5

// Niveaux d'utilisateur — récupérateur d'argent
export const LEVELS = [
  { id: 1, name: 'Éveillé', min: 0, max: 99, emoji: '👁️', color: '#86efac' },
  { id: 2, name: 'Chercheur', min: 100, max: 499, emoji: '🔍', color: '#4ade80' },
  { id: 3, name: 'Récupérateur', min: 500, max: 1999, emoji: '💰', color: '#10b981' },
  { id: 4, name: 'Stratège', min: 2000, max: 9999, emoji: '🧠', color: '#059669' },
  { id: 5, name: 'Maître', min: 10000, max: Number.MAX_SAFE_INTEGER, emoji: '👑', color: '#F59E0B' },
] as const

// Catégories d'aides scannées
export const AIDE_CATEGORIES = [
  { id: 'logement', name: 'Logement', icon: '🏠', color: '#10B981', examples: 'APL, Visale, FSL, MaPrimeRénov\'' },
  { id: 'sante', name: 'Santé', icon: '🏥', color: '#EF4444', examples: 'CSS, CMU, ALD, mutuelle' },
  { id: 'emploi', name: 'Emploi', icon: '💼', color: '#3B82F6', examples: 'ARE, Prime activité, CPF' },
  { id: 'famille', name: 'Famille', icon: '👨‍👩‍👧', color: '#F472B6', examples: 'PAJE, allocations, rentrée scolaire' },
  { id: 'handicap', name: 'Handicap', icon: '♿', color: '#8B5CF6', examples: 'AAH, AEEH, PCH, MDPH' },
  { id: 'transport', name: 'Transport', icon: '🚆', color: '#06B6D4', examples: 'Pass Navigo, prime carburant' },
  { id: 'energie', name: 'Énergie', icon: '⚡', color: '#F59E0B', examples: 'Chèque énergie, MaPrimeRénov\'' },
  { id: 'retraite', name: 'Retraite', icon: '👴', color: '#A855F7', examples: 'ASPA, retraite progressive' },
  { id: 'rsa', name: 'RSA / Solidarité', icon: '🤝', color: '#22C55E', examples: 'RSA, prime de Noël' },
  { id: 'bourses', name: 'Bourses', icon: '🎓', color: '#6366F1', examples: 'Crous, mérite, BTS' },
  { id: 'fiscal', name: 'Optimisation fiscale', icon: '📊', color: '#0EA5E9', examples: 'Crédits d\'impôt, déductions' },
  { id: 'frontalier', name: 'Frontalier', icon: '🌍', color: '#14B8A6', examples: 'CH, LU, DE, BE, IT, ES, MC, AD' },
  { id: 'argent_oublie', name: 'Argent oublié', icon: '💸', color: '#FBBF24', examples: 'Ciclade, assurances vie, trop-perçus' },
  { id: 'juridique', name: 'Juridique', icon: '⚖️', color: '#7C3AED', examples: 'Indemnités, contestations, vices' },
] as const

export type AideCategoryId = typeof AIDE_CATEGORIES[number]['id']

// Corridors frontaliers (M2)
export const CORRIDORS_FRONTALIERS = [
  { id: 'CH', name: 'Suisse', flag: '🇨🇭', convention: '1966', notes: 'Quasi-résident, télétravail 25%' },
  { id: 'LU', name: 'Luxembourg', flag: '🇱🇺', convention: '2018', notes: 'Télétravail 34 jours, accord 2024' },
  { id: 'DE', name: 'Allemagne', flag: '🇩🇪', convention: '1959', notes: 'Zone 30km, télétravail 19 jours' },
  { id: 'BE', name: 'Belgique', flag: '🇧🇪', convention: '2008', notes: 'Télétravail 34 jours' },
  { id: 'IT', name: 'Italie', flag: '🇮🇹', convention: '1989', notes: 'Zone 20km' },
  { id: 'ES', name: 'Espagne', flag: '🇪🇸', convention: '1995', notes: 'Pyrénées' },
  { id: 'MC', name: 'Monaco', flag: '🇲🇨', convention: '1963', notes: 'Statut particulier' },
  { id: 'AD', name: 'Andorre', flag: '🇦🇩', convention: '2013', notes: 'Convention récente' },
] as const

// Catégories de missions PURAMA Aide (gamification)
export const MISSION_CATEGORIES = [
  { id: 'note_app', name: 'Noter l\'app', icon: '⭐', color: '#fbbf24', reward: 200, description: 'Noter PURAMA Aide sur App Store' },
  { id: 'story_share', name: 'Partager en story', icon: '📱', color: '#ec4899', reward: 100, description: 'Partager l\'app sur les réseaux' },
  { id: 'parrainage', name: 'Parrainer un ami', icon: '🤝', color: '#10b981', reward: 500, description: 'Inviter un ami qui s\'inscrit' },
  { id: 'feedback', name: 'Feedback détaillé', icon: '💬', color: '#3b82f6', reward: 150, description: 'Donner un avis constructif' },
  { id: 'video_temoignage', name: 'Vidéo témoignage', icon: '🎬', color: '#f43f5e', reward: 1000, description: 'Témoignage vidéo sur les gains récupérés' },
  { id: 'completer_profil', name: 'Compléter profil', icon: '✏️', color: '#8b5cf6', reward: 50, description: 'Remplir toutes les infos' },
  { id: 'premier_scan', name: 'Premier scan', icon: '🔍', color: '#10B981', reward: 300, description: 'Lancer ton premier scan financier' },
  { id: 'lancer_demarche', name: 'Lancer une démarche', icon: '🚀', color: '#F59E0B', reward: 200, description: 'Activer une demande d\'aide' },
  { id: 'partager_resultat', name: 'Partager résultat', icon: '📊', color: '#06b6d4', reward: 250, description: 'Partager ton montant récupérable' },
  { id: 'inviter_3_amis', name: 'Inviter 3 amis', icon: '👥', color: '#a855f7', reward: 800, description: 'Inviter 3 personnes qui s\'inscrivent' },
] as const

export type MissionCategoryId = typeof MISSION_CATEGORIES[number]['id']

// Récompenses missions
export const MISSION_REWARDS = {
  min_credits: 50,
  max_credits: 1000,
  note_app: 200,
  story_share: 100,
  parrainage: 500,
  feedback: 150,
  video_temoignage: 1000,
  completer_profil: 50,
  premier_scan: 300,
  lancer_demarche: 200,
  partager_resultat: 250,
  inviter_3_amis: 800,
} as const

// Commissions
export const COMMISSIONS = {
  marketplace: 15,
  user_mission: 20,
  enterprise_mission: 10,
} as const

// Referrals
export const REFERRAL = {
  referrer_first_percent: 50, // 50% du premier paiement
  referrer_lifetime_percent: 10, // 10% à vie
  referred_first_month_discount: 50, // -50% premier mois
  cross_app_percent: 5,
  level_bonus_x2: true,
} as const

// Influencer
export const INFLUENCER = {
  promo_validity_days: 7,
  promo_discount: 50,
  commission_first: 50,
  commission_recurring: 10,
} as const

// Rôles
export const ROLES = {
  user: 'user',
  super_admin: 'super_admin',
} as const

// Routes publiques (middleware)
export const PUBLIC_ROUTES = [
  '/',
  '/pricing',
  '/how-it-works',
  '/ecosystem',
  '/status',
  '/changelog',
  '/privacy',
  '/terms',
  '/legal',
  '/offline',
  '/login',
  '/signup',
  '/register',
  '/mentions-legales',
  '/politique-confidentialite',
  '/cgv',
  '/cgu',
  '/cookies',
  '/aide',
  '/contact',
  '/accessibilite',
]
