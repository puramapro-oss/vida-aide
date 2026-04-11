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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: pData, error: pErr } = await supabase
        .from("profiles")
        .select("id, wallet_balance, purama_points, total_money_recovered")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (pErr) {
        setError(pErr.message);
        setLoading(false);
        return;
      }
      setProfile(pData as ProfileSlim | null);
      if (pData) {
        const { data: txs } = await supabase
          .from("wallet_transactions")
          .select("id, type, amount, description, created_at")
          .eq("user_id", (pData as ProfileSlim).id)
          .order("created_at", { ascending: false })
          .limit(20);
        if (!cancelled) setTransactions((txs as WalletTx[]) ?? []);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const balanceEuro = Number(profile?.wallet_balance ?? 0);
  const points = profile?.purama_points ?? 0;
  const lifetime = Number(profile?.total_money_recovered ?? 0);

  function openWithdraw() {
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
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <Wallet color={theme.gold} size={18} />
          <Text
            style={{ color: theme.gold, fontSize: 12, letterSpacing: 1.5 }}
          >
            WALLET
          </Text>
        </View>
        <Text
          style={{
            color: theme.text,
            fontSize: 26,
            fontWeight: "700",
            marginTop: 4,
          }}
        >
          Tes gains réels.
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
            style={{
              color: theme.text,
              fontSize: 40,
              fontWeight: "800",
              letterSpacing: -1,
              marginTop: 4,
            }}
          >
            {balanceEuro.toFixed(2)} €
          </Text>
        )}
        <Text style={{ color: theme.dim, fontSize: 11, marginTop: 4 }}>
          Retrait IBAN dès {MIN_WITHDRAW} €
        </Text>
        <View style={{ marginTop: 14 }}>
          <Button
            testID="wallet-withdraw-cta"
            onPress={openWithdraw}
            disabled={balanceEuro < MIN_WITHDRAW}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
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
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <Sparkles color={theme.cyan} size={14} />
              <Text style={{ color: theme.muted, fontSize: 11 }}>Points</Text>
            </View>
            <Text
              style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}
            >
              {points.toLocaleString("fr-FR")}
            </Text>
            <Text style={{ color: theme.dim, fontSize: 10, marginTop: 2 }}>
              ≈ {(points / 100).toFixed(2)} €
            </Text>
          </Card>
        </View>
        <View style={{ flex: 1 }}>
          <Card testID="wallet-lifetime-card">
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <Coins color={theme.primary} size={14} />
              <Text style={{ color: theme.muted, fontSize: 11 }}>
                Cumulé
              </Text>
            </View>
            <Text
              style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}
            >
              {lifetime.toFixed(0)} €
            </Text>
            <Text style={{ color: theme.dim, fontSize: 10, marginTop: 2 }}>
              Depuis l&apos;inscription
            </Text>
          </Card>
        </View>
      </View>

      <Text
        style={{
          color: theme.muted,
          fontSize: 11,
          letterSpacing: 1.5,
          marginTop: 24,
          marginBottom: 10,
          textTransform: "uppercase",
        }}
      >
        Historique
      </Text>

      {error ? (
        <Card testID="wallet-error-card">
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </Card>
      ) : !loading && transactions.length === 0 ? (
        <Card testID="wallet-empty-card">
          <Text style={{ color: theme.muted, fontSize: 13 }}>
            Aucune transaction pour l&apos;instant. Parraine un ami ou remporte un
            concours pour voir tes gains ici.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 8 }}>
          {transactions.map((tx) => (
            <Card key={tx.id} testID={`wallet-tx-${tx.id}`}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: 14,
                      fontWeight: "600",
                    }}
                  >
                    {labelForType(tx.type)}
                  </Text>
                  {tx.description ? (
                    <Text
                      style={{
                        color: theme.muted,
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      {tx.description}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={{
                    color: Number(tx.amount) >= 0 ? theme.primary : theme.danger,
                    fontSize: 15,
                    fontWeight: "700",
                  }}
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
