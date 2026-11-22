import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';
import { readScanResponse, ScanValidationError, type ScanEstimateResponse } from '@/lib/scan';
import { attemptPayload, clearAttempt, loadAttempt, newAttempt, saveAttempt, scanContent, type ScanAttempt, type ScanPayload } from '@/lib/scan-attempt';

export function useScanRequest(userId?: string) {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ScanAttempt | null>(null);
  const [restored, setRestored] = useState<ScanPayload | null>(null);
  const [received, setReceived] = useState<{ owner: string; data: ScanEstimateResponse } | null>(null);
  const current = useRef<ScanAttempt | null>(null);
  const inFlight = useRef(false);
  const storageBusy = useRef(false);
  const lifecycle = useRef<{ mounted: boolean; focused: boolean; generation: number; owner?: string }>({ mounted: false, focused: false, generation: 0 });

  useEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    return () => { state.mounted = false; state.generation += 1; };
  }, []);
  useFocusEffect(useCallback(() => {
    const state = lifecycle.current;
    state.focused = true; state.owner = userId; state.generation += 1;
    return () => { state.focused = false; state.generation += 1; };
  }, [userId]));
  useEffect(() => {
    let cancelled = false;
    setReady(false); setPreparing(true); storageBusy.current = true;
    setReceived(null); setError(null); setAttempt(null); setRestored(null); current.current = null;
    if (userId) void loadAttempt(userId).then((saved) => {
      if (cancelled) return;
      const payload = saved ? attemptPayload(saved) : null;
      if (payload && payload.type !== 'financial') throw new ScanValidationError('Ce type de demande ne peut pas être repris dans le scanner natif.');
      current.current = saved; setAttempt(saved); setRestored(payload); setReady(true);
    }).catch(() => {
      if (!cancelled) setError('Impossible de lire la demande conservée. Réessaie une nouvelle demande avant de lancer un scan.');
    }).finally(() => {
      if (!cancelled) { storageBusy.current = false; setPreparing(false); }
    });
    else { storageBusy.current = false; setPreparing(false); }
    return () => { cancelled = true; };
  }, [userId]);

  async function submit(payload: ScanPayload) {
    if (!userId || !ready || inFlight.current || storageBusy.current) return;
    const generation = lifecycle.current.generation;
    const active = () => lifecycle.current.mounted && lifecycle.current.focused && lifecycle.current.owner === userId && lifecycle.current.generation === generation;
    inFlight.current = true; setLoading(true); setError(null);
    try {
      const content = scanContent(payload);
      const request = current.current?.owner === userId && current.current.content === content ? current.current : newAttempt(userId, content);
      current.current = request; setAttempt(request);
      try { await saveAttempt(request); }
      catch { throw new ScanValidationError('Impossible de conserver la demande sur cet appareil. Aucun scan n’a été lancé.'); }
      if (!active()) return;
      const data = readScanResponse(await api<unknown>('/api/scan', {
        method: 'POST', body: JSON.stringify({ ...attemptPayload(request), request_id: request.requestId }),
      }, userId, 200), request.requestId);
      if (!active()) return;
      setReceived({ owner: userId, data });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (cause) {
      if (!active()) return;
      let message = cause instanceof ApiError || cause instanceof ScanValidationError ? cause.message
        : 'Réponse du scan non confirmée. Reprends cette même demande pour consulter son état sans relancer le modèle.';
      if (cause instanceof ApiError && cause.status === 409 && cause.scanId === current.current?.requestId) {
        if (cause.code === 'scan_in_progress') message = 'Cette demande est encore en cours. Reprends la même demande pour consulter son état, sans relancer le modèle.';
        if (cause.code === 'scan_attempt_failed') message = 'Cette tentative est terminée sans résultat et reste décomptée. Pour relancer le modèle, prépare explicitement une nouvelle demande.';
      }
      setError(message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      inFlight.current = false;
      if (lifecycle.current.mounted) setLoading(false);
    }
  }

  async function reset() {
    if (!userId || inFlight.current || storageBusy.current) return;
    storageBusy.current = true; setPreparing(true);
    setReceived(null); setError(null); setReady(false);
    try {
      await clearAttempt(userId);
      if (lifecycle.current.owner !== userId || !lifecycle.current.mounted) return;
      current.current = null; setAttempt(null); setRestored(null); setReady(true);
    } catch { if (lifecycle.current.mounted) setError('Impossible de préparer une nouvelle demande sur cet appareil.'); }
    finally { storageBusy.current = false; if (lifecycle.current.mounted) setPreparing(false); }
  }
  return { loading, preparing, ready: ready && !preparing, error, setError, attempt: attempt?.owner === userId ? attempt : null, restored,
    result: received?.owner === userId ? received.data : null, submit, reset };
}
