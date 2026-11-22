import { Platform } from 'react-native';
import { uuid } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import { ScanValidationError } from './scan';

export type ScanPayload = { type: 'financial' | 'fiscal' | 'forgotten_money'; situation: Record<string, unknown> };
export type ScanAttempt = { version: 1; owner: string; requestId: string; content: string };
const key = (owner: string) => `vida_aide_scan_v1_${owner}`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ['emploi', 'pays_frontalier', 'revenus_mensuels_nets', 'revenus_annuels_bruts', 'logement', 'loyer_mensuel', 'famille', 'enfants', 'enfants_a_charge', 'handicap', 'handicap_taux', 'region', 'age'];
const storageQueues = new Map<string, Promise<void>>();

// Keep a remounted form behind writes/deletions started by its previous instance.
function inStorageOrder<T>(owner: string, operation: () => T | Promise<T>): Promise<T> {
  const result = (storageQueues.get(owner) ?? Promise.resolve()).then(operation);
  const settled = result.then(() => undefined, () => undefined);
  storageQueues.set(owner, settled);
  void settled.then(() => { if (storageQueues.get(owner) === settled) storageQueues.delete(owner); });
  return result;
}

export function scanContent(payload: ScanPayload): string {
  return JSON.stringify({ type: payload.type, situation: Object.fromEntries(Object.entries(payload.situation)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) });
}

export function attemptPayload(attempt: ScanAttempt): ScanPayload {
  const value: unknown = JSON.parse(attempt.content);
  if (!value || typeof value !== 'object' || !('type' in value) || !('situation' in value)
    || typeof value.type !== 'string' || !['financial', 'fiscal', 'forgotten_money'].includes(value.type)
    || !value.situation || typeof value.situation !== 'object' || Array.isArray(value.situation)) throw new ScanValidationError('La demande conservée est illisible. Choisis explicitement une nouvelle demande.');
  for (const [field, entry] of Object.entries(value.situation)) {
    const valid = fields.includes(field) && (field === 'handicap' ? typeof entry === 'boolean'
      : ['emploi', 'pays_frontalier', 'logement', 'famille', 'region'].includes(field)
        ? typeof entry === 'string' || (field === 'pays_frontalier' && entry === null)
        : typeof entry === 'number' && Number.isFinite(entry));
    if (!valid) throw new ScanValidationError('La demande conservée est invalide. Choisis explicitement une nouvelle demande.');
  }
  return value as ScanPayload;
}

export async function loadAttempt(owner: string): Promise<ScanAttempt | null> {
  const raw = await inStorageOrder(owner, () => Platform.OS === 'web' ? globalThis.sessionStorage.getItem(key(owner)) : SecureStore.getItemAsync(key(owner)));
  if (!raw) return null;
  const value = JSON.parse(raw) as Partial<ScanAttempt>;
  if (value.version !== 1 || value.owner !== owner || typeof value.requestId !== 'string'
    || !uuidPattern.test(value.requestId) || typeof value.content !== 'string') throw new ScanValidationError('La demande conservée est invalide. Choisis explicitement une nouvelle demande.');
  attemptPayload(value as ScanAttempt);
  return value as ScanAttempt;
}

export async function saveAttempt(attempt: ScanAttempt): Promise<void> {
  const value = JSON.stringify(attempt);
  await inStorageOrder(attempt.owner, () => Platform.OS === 'web' ? globalThis.sessionStorage.setItem(key(attempt.owner), value)
    : SecureStore.setItemAsync(key(attempt.owner), value));
}

export async function clearAttempt(owner: string): Promise<void> {
  await inStorageOrder(owner, () => Platform.OS === 'web' ? globalThis.sessionStorage.removeItem(key(owner))
    : SecureStore.deleteItemAsync(key(owner)));
}

export function newAttempt(owner: string, content: string): ScanAttempt {
  try {
    const requestId = uuid.v4();
    if (!uuidPattern.test(requestId)) throw new Error('Invalid UUID');
    return { version: 1, owner, requestId, content };
  } catch {
    throw new ScanValidationError('Impossible de créer un identifiant sûr pour la demande. Aucun scan n’a été lancé.');
  }
}
