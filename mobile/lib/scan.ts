// The existing POST /api/scan response; amounts are estimates, never transfers.
export class ScanValidationError extends Error {}

export type ScanEstimateItem = {
  aide: string;
  category: string;
  montant_estime: number;
  unite: 'an' | 'mois' | 'unique';
  eligibilite: string;
  conditions: string[];
  demarche: string;
  difficulte: 'facile' | 'moyen' | 'complexe';
  organisme: string;
  lien_officiel?: string;
  delai_jours?: number;
};

export type ScanEstimateResponse = {
  ok: true;
  scan_id: string;
  results: ScanEstimateItem[];
  total_recoverable: number;
  total_recoverable_monthly: number;
  summary: string;
  warnings?: ('profile_update_failed' | 'notification_failed')[];
};

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9_999_999_999.99;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Same decimal rounding and periods as src/lib/scan-result.ts. Stay within
// safe integer cents; this checks arithmetic, never legal cumulation of aids.
function cents(value: number): number {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = whole + fraction;
  const shift = 2 + Number(exponent) - fraction.length;
  if (shift >= 0) return Number(digits) * 10 ** shift;
  const cut = digits.length + shift;
  return (cut > 0 ? Number(digits.slice(0, cut)) : 0)
    + (cut >= 0 && Number(digits[cut] || '0') >= 5 ? 1 : 0);
}

function coherentTotals(value: ScanEstimateResponse): boolean {
  let annual = 0;
  let monthly = 0;
  for (const candidate of value.results) {
    const candidateCents = cents(candidate.montant_estime);
    annual += candidateCents * (candidate.unite === 'mois' ? 12 : 1);
    if (candidate.unite === 'mois') monthly += candidateCents;
    if (!Number.isSafeInteger(annual) || !Number.isSafeInteger(monthly)) return false;
  }
  return Math.abs(cents(value.total_recoverable) - annual) <= 1
    && Math.abs(cents(value.total_recoverable_monthly) - monthly) <= 1;
}

function isItem(value: unknown): value is ScanEstimateItem {
  if (!record(value)) return false;
  return ['aide', 'category', 'eligibilite', 'demarche', 'organisme'].every((key) => text(value[key]))
    && amount(value.montant_estime) && typeof value.unite === 'string' && ['an', 'mois', 'unique'].includes(value.unite)
    && typeof value.difficulte === 'string' && ['facile', 'moyen', 'complexe'].includes(value.difficulte)
    && Array.isArray(value.conditions) && value.conditions.every(text)
    && (value.lien_officiel === undefined || (typeof value.lien_officiel === 'string' && /^https?:\/\/\S+$/i.test(value.lien_officiel)))
    && (value.delai_jours === undefined || (typeof value.delai_jours === 'number' && Number.isInteger(value.delai_jours) && value.delai_jours >= 0));
}

export function readScanResponse(value: unknown, requestId: string): ScanEstimateResponse {
  if (!record(value) || value.ok !== true || typeof value.scan_id !== 'string' || !uuid.test(value.scan_id) || value.scan_id !== requestId
    || !Array.isArray(value.results) || !value.results.every(isItem)
    || !amount(value.total_recoverable) || !amount(value.total_recoverable_monthly) || !text(value.summary)
    || (value.warnings !== undefined && (!Array.isArray(value.warnings)
      || !value.warnings.every((warning) => warning === 'profile_update_failed' || warning === 'notification_failed')))) {
    throw new ScanValidationError('Réponse du scan non confirmée. Consulte tes scans enregistrés avant de relancer.');
  }
  const response = value as ScanEstimateResponse;
  if (!coherentTotals(response)) throw new ScanValidationError('Réponse du scan non confirmée : les totaux sont incohérents. Consulte tes scans enregistrés avant de relancer.');
  return response;
}

export function inputNumber(value: string, label: string, max: number, integer = false, min = 0): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(',', '.'));
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(trimmed) || !Number.isFinite(parsed)
    || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new ScanValidationError(`${label} : saisis ${integer ? 'un entier' : 'un nombre'} entre ${min} et ${max}.`);
  }
  return parsed;
}
