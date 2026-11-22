import { useEffect, useState } from "react";
import { Text, View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useAuth } from "@/store/auth";
import { supabase } from "@/lib/supabase";
import { theme } from "@/lib/theme";
import {
  Coins,
  Search,
  MessageSquare,
  Wallet,
  ArrowRight,
  Sparkles,
} from "lucide-react-native";

type Profile = {
  id: string;
  full_name: string | null;
  wallet_balance: number;
  purama_points: number;
  total_money_recovered: number;
  subscription_plan: string;
};

export default function DashboardScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setOwner(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        if (!userId) throw new Error('Sign-in required');
        const { data, error: readError } = await supabase
        .from("profiles")
        .select(
          "id, full_name, wallet_balance, purama_points, total_money_recovered, subscription_plan"
        )
        .eq("auth_user_id", userId)
        .maybeSingle();
        if (readError || !data || typeof data.id !== 'string') throw new Error('Profile unavailable');
        if (!cancelled) setProfile(data as Profile);
      } catch {
        if (!cancelled) setError('Impossible de charger le profil. Les montants sont indisponibles.');
      } finally {
        if (!cancelled) { setOwner(userId ?? null); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const currentProfile = owner === userId ? profile : null;

  const firstName =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    currentProfile?.full_name?.split(" ")[0] ??
    "👋";

  const historical = finiteAmount(currentProfile?.total_money_recovered);
  const walletEuro = finiteAmount(currentProfile?.wallet_balance);
  const points = finiteAmount(currentProfile?.purama_points);

  return (
    <Screen>
      <View style={{ marginBottom: 24, marginTop: 8 }}>
        <Text style={{ color: theme.primary, fontSize: 12, letterSpacing: 2 }}>
          PURAMA AIDE
        </Text>
        <Text
          style={{
            color: theme.text,
            fontSize: 28,
            fontWeight: "700",
            marginTop: 4,
          }}
        >
          Salut {firstName}.
        </Text>
        <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
          Explore les aides possibles pour ta situation.
        </Text>
      </View>

      {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, marginBottom: 12 }}>{error}</Text> : null}
      {/* Ancien compteur conservé, distinct des estimations de scans */}
      <Card testID="dashboard-total-card">
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Coins color={theme.primary} size={18} />
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            Historique non vérifié
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <Text
            style={{
              color: theme.text,
              fontSize: 36,
              fontWeight: "800",
              letterSpacing: -1,
            }}
            testID="dashboard-total-euro"
          >
            {historical === null ? 'Indisponible' : `${historical.toLocaleString("fr-FR")} €`}
          </Text>
        )}
        <Text style={{ color: theme.dim, fontSize: 11, marginTop: 4 }}>
          Ancien compteur conservé, sans preuve de versement. Lance un scan pour obtenir une nouvelle estimation indicative.
        </Text>
        <View style={{ marginTop: 14 }}>
          <Button
            testID="dashboard-scan-cta"
            onPress={() => router.push("/(tabs)/scanner")}
          >
            Lancer un scan financier →
          </Button>
        </View>
      </Card>

      {/* Wallet + points mini */}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Card
            testID="dashboard-wallet-card"
            onPress={() => router.push("/(tabs)/wallet")}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <Wallet color={theme.gold} size={14} />
              <Text style={{ color: theme.muted, fontSize: 11 }}>Wallet</Text>
            </View>
            <Text
              style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}
            >
              {walletEuro === null ? 'Indisponible' : `${walletEuro.toFixed(2)} €`}
            </Text>
            <Text style={{ color: theme.dim, fontSize: 10, marginTop: 2 }}>
              Retrait dès 5 €
            </Text>
          </Card>
        </View>
        <View style={{ flex: 1 }}>
          <Card
            testID="dashboard-points-card"
            onPress={() => router.push("/(tabs)/wallet")}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
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
              1 pt = 0,01 €
            </Text>
          </Card>
        </View>
      </View>

      {/* Quick actions */}
      <View style={{ gap: 10, marginTop: 12 }}>
        <Card
          testID="dashboard-scanner-shortcut"
          onPress={() => router.push("/(tabs)/scanner")}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: "rgba(16,185,129,0.2)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Search color={theme.primary} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}
              >
                Scanner ma situation
              </Text>
              <Text
                style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}
              >
                Pistes d’aides, remboursements et optimisation à vérifier
              </Text>
            </View>
            <ArrowRight color={theme.dim} size={18} />
          </View>
        </Card>

        <Card
          testID="dashboard-chat-shortcut"
          onPress={() => router.push("/(tabs)/chat")}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: "rgba(14,165,233,0.2)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MessageSquare color={theme.cyan} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}
              >
                Demander à AideIA
              </Text>
              <Text
                style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}
              >
                Expert finance, aides, fiscalité, droits
              </Text>
            </View>
            <ArrowRight color={theme.dim} size={18} />
          </View>
        </Card>

        <Card
          testID="dashboard-upgrade-card"
          onPress={() => router.push("/abonnement")}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: "rgba(245,158,11,0.18)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles color={theme.gold} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}
              >
                Passe Premium — 14 j gratuits
              </Text>
              <Text
                style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}
              >
                Scans illimités, démarches auto, retraits
              </Text>
            </View>
            <ArrowRight color={theme.gold} size={18} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

function finiteAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
