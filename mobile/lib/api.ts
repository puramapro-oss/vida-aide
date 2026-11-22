import { supabase } from "./supabase";

export const API_BASE = "https://vida-aide.purama.dev";

export class ApiError extends Error {
  status: number;
  code?: string;
  scanId?: string;
  constructor(message: string, status: number, code?: string, scanId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.scanId = scanId;
  }
}

async function authHeaders(expectedUserId?: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || (expectedUserId && data.session?.user.id !== expectedUserId)) {
    throw new ApiError('La session a changé ou ne peut pas être vérifiée. Reconnecte-toi avant de continuer.', 401);
  }
  const token = data.session?.access_token;
  if (expectedUserId && !token) throw new ApiError('Connexion requise.', 401);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
  expectedUserId?: string,
  expectedStatus?: number
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(await authHeaders(expectedUserId)),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.ok && expectedStatus !== undefined && res.status !== expectedStatus) {
    throw new ApiError('Réponse non confirmée. Reprends la même demande.', res.status);
  }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    let code: string | undefined;
    let scanId: string | undefined;
    try {
      const j = await res.json();
      msg = typeof j?.error === 'string' ? j.error : typeof j?.message === 'string' ? j.message : msg;
      code = typeof j?.code === 'string' ? j.code : undefined;
      scanId = typeof j?.scan_id === 'string' ? j.scan_id : undefined;
    } catch {
      // body non-JSON, garde le message par défaut
    }
    throw new ApiError(msg, res.status, code, scanId);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
