import { useEffect, useState } from "react";
import { Text, View, ActivityIndicator, Alert, Linking } from "react-native";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { API_BASE } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/store/auth";
import { theme } from "@/lib/theme";
import { Wallet, Sparkles, ArrowDownToLine, Coins } from "lucide-react-native";

type WalletTx = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
};

type ProfileSlim = {
  id: string;
  wallet_balance: number;
  purama_points: number;
  total_money_recovered: number;
};

const MIN_WITHDRAW = 5;

function labelForType(t: string) {
  const map: Record<string, string> = {
    contest_prize: "Prix concours",
    referral: "Commission parrainage",
    mission: "Récompense mission",
    withdrawal: "Retrait",
    bonus: "Bonus",
    cashback: "Cashback",
    redistribution: "Redistribution",
    refund: "Remboursement",
  };
  return map[t] ?? t;
}

export default function WalletScreen() {
  const user = useAuth((s) => s.user);
  const [profile, setProfile] = useState<ProfileSlim | null>(null);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setTransactions([]);
    setOwner(null);
    setHistoryLoaded(false);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        if (!userId) throw new Error('Sign-in required');
        const { data: pData, error: pErr } = await supabase
        .from("profiles")
        .select("id, wallet_balance, purama_points, total_money_recovered")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (pErr || !pData || typeof pData.id !== 'string') throw new Error('Profile unavailable');
      setProfile(pData as ProfileSlim);
      setOwner(userId);
        const { data: txs, error: txError } = await supabase
          .from("wallet_transactions")
          .select("id, type, amount, description, created_at")
          .eq("user_id", (pData as ProfileSlim).id)
          .order("created_at", { ascending: false })
          .limit(20);
        if (cancelled) return;
        if (txError || !Array.isArray(txs)) {
          setError('Impossible de charger l’historique des transactions.');
        } else {
          setTransactions(txs as WalletTx[]);
          setHistoryLoaded(true);
        }
      } catch {
        if (!cancelled) setError('Impossible de charger le portefeuille. Les données sont indisponibles.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const currentProfile = owner === userId ? profile : null;
  const balanceEuro = finiteAmount(currentProfile?.wallet_balance);
  const points = finiteAmount(currentProfile?.purama_points);
  const lifetime = finiteAmount(currentProfile?.total_money_recovered);
  const currentTransactions = owner === userId ? transactions : [];

  function openWithdraw() {
    if (balanceEuro === null) return;
    if (balanceEuro < MIN_WITHDRAW) {
      Alert.alert(
        "Seuil non atteint",
        `Tu peux retirer dès ${MIN_WITHDRAW} €. Il te manque ${(
          MIN_WITHDRAW - balanceEuro
        ).toFixed(2)} €.`
      );
      return;
    }
    // Open web wallet for IBAN entry (mobile form v2)
    Linking.openURL(`${API_BASE}/dashboard/wallet`).catch(() => {});
  }

  return (
    <Screen>
      <View style={{ marginBottom: 20, marginTop: 8 }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, }}
        >
          <Wallet color={theme.gold} size={18} />
          <Text
            style={{ color: theme.gold, fontSize: 12, letterSpacing: 1.5 }}
          >
            WALLET
          </Text>
        </View>
        <Text
          style={{ color: theme.text, fontSize: 26, fontWeight: "700", marginTop: 4, }}
        >
          Ton portefeuille.
        </Text>
      </View>

      <Card testID="wallet-balance-card">
        <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 1 }}>
          SOLDE DISPONIBLE
        </Text>
        {loading ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 8 }} />
        ) : (
          <Text
            testID="wallet-balance-euro"
            style={{ color: theme.text, fontSize: 40, fontWeight: "800", letterSpacing: -1, marginTop: 4, }}
          >
            {balanceEuro === null ? 'Indisponible' : `${balanceEuro.toFixed(2)} €`}
          </Text>
        )}
        <Text style={{ color: theme.dim, fontSize: 11, marginTop: 4 }}>
          Retrait IBAN dès {MIN_WITHDRAW} €
        </Text>
        <View style={{ marginTop: 14 }}>
          <Button
            testID="wallet-withdraw-cta"
            onPress={openWithdraw}
            disabled={balanceEuro === null || balanceEuro < MIN_WITHDRAW}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8, }}
            >
              <ArrowDownToLine color="#fff" size={16} />
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
                Retirer maintenant
              </Text>
            </View>
          </Button>
        </View>
      </Card>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Card testID="wallet-points-card">
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, }}
            >
              <Sparkles color={theme.cyan} size={14} />
              <Text style={{ color: theme.muted, fontSize: 11 }}>Points</Text>
            </View>
            <Text
              style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}
            >
              {points === null ? 'Indisponible' : points.toLocaleString("fr-FR")}
            </Text>
            <Text style={{ color: theme.dim, fontSize: 10, marginTop: 2 }}>
              {points === null ? 'Conversion indisponible' : `≈ ${(points / 100).toFixed(2)} €`}
            </Text>
          </Card>
        </View>
        <View style={{ flex: 1 }}>
          <Card testID="wallet-lifetime-card">
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, }}
            >
              <Coins color={theme.primary} size={14} />
              <Text style={{ color: theme.muted, fontSize: 11 }}>
                Historique non vérifié
              </Text>
            </View>
            <Text
              style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}
            >
              {lifetime === null ? 'Indisponible' : `${lifetime.toFixed(0)} €`}
            </Text>
            <Text style={{ color: theme.dim, fontSize: 10, marginTop: 2 }}>
              Ancien compteur conservé, sans preuve de versement.
            </Text>
          </Card>
        </View>
      </View>

      <Text
        style={{ color: theme.muted, fontSize: 11, letterSpacing: 1.5, marginTop: 24, marginBottom: 10, textTransform: "uppercase", }}
      >
        Historique
      </Text>

      {error ? (
        <Card testID="wallet-error-card">
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </Card>
      ) : !loading && owner === userId && historyLoaded && currentTransactions.length === 0 ? (
        <Card testID="wallet-empty-card">
          <Text style={{ color: theme.muted, fontSize: 13 }}>
            Aucune transaction pour l&apos;instant. Parraine un ami ou remporte un
            concours pour voir tes gains ici.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 8 }}>
          {currentTransactions.map((tx) => (
            <Card key={tx.id} testID={`wallet-tx-${tx.id}`}>
              <View
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: theme.text, fontSize: 14, fontWeight: "600", }}
                  >
                    {labelForType(tx.type)}
                  </Text>
                  {tx.description ? (
                    <Text
                      style={{ color: theme.muted, fontSize: 11, marginTop: 2, }}
                    >
                      {tx.description}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={{ color: Number(tx.amount) >= 0 ? theme.primary : theme.danger, fontSize: 15, fontWeight: "700", }}
                >
                  {Number(tx.amount) >= 0 ? "+" : ""}
                  {Number(tx.amount).toFixed(2)} €
                </Text>
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function finiteAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
