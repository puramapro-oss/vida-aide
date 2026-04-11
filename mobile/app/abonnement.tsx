import { useState } from "react";
import { Linking, Text, View, Alert, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { api, ApiError, API_BASE } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Check, Sparkles, X } from "lucide-react-native";

type CheckoutResponse = { url: string };

type Interval = "monthly" | "yearly";

const PREMIUM_FEATURES = [
  "Scans financiers illimités",
  "Démarches auto lancées en 1 clic",
  "Alertes droits et aides inédites",
  "Retraits IBAN dès 5 €",
  "Concours hebdo + tirages mensuels",
  "Chat AideIA illimité",
  "Support prioritaire",
];

const FREE_FEATURES = [
  "1 scan financier / jour",
  "Voir ton montant récupérable",
  "20 messages AideIA / jour",
  "Communauté + missions",
];

export default function AbonnementScreen() {
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>("yearly");
  const [loading, setLoading] = useState(false);

  async function subscribe() {
    setLoading(true);
    try {
      const data = await api<CheckoutResponse>("/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ interval }),
      });
      if (data.url) {
        await Linking.openURL(data.url);
      } else {
        throw new Error("URL Stripe manquante.");
      }
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 401
          ? "Connecte-toi avant de souscrire."
          : "Paiement indisponible. Réessaie dans un instant.";
      Alert.alert("Oups", msg);
    } finally {
      setLoading(false);
    }
  }

  async function openPortal() {
    try {
      const data = await api<CheckoutResponse>("/api/stripe/portal", {
        method: "POST",
      });
      if (data.url) await Linking.openURL(data.url);
    } catch {
      await Linking.openURL(`${API_BASE}/dashboard/wallet`);
    }
  }

  const monthly = 9.99;
  const yearly = 83.9;
  const yearlyEqMonthly = yearly / 12;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
        <Pressable
          onPress={() => router.back()}
          testID="abo-close"
          style={{ padding: 8, marginLeft: -8 }}
          accessibilityRole="button"
        >
          <X color={theme.muted} size={22} />
        </Pressable>
      </View>

      <View style={{ marginTop: 12, marginBottom: 20 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <Sparkles color={theme.gold} size={18} />
          <Text
            style={{ color: theme.gold, fontSize: 12, letterSpacing: 1.5 }}
          >
            PREMIUM
          </Text>
        </View>
        <Text
          style={{
            color: theme.text,
            fontSize: 28,
            fontWeight: "800",
            letterSpacing: -0.5,
          }}
        >
          Débloque tout.
        </Text>
        <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
          14 jours d&apos;essai gratuit. Sans engagement. Annulable en 1 clic.
        </Text>
      </View>

      {/* Interval toggle */}
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          padding: 4,
          backgroundColor: "rgba(255,255,255,0.04)",
          borderRadius: 999,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          marginBottom: 14,
        }}
      >
        <Pressable
          onPress={() => setInterval("monthly")}
          testID="abo-monthly"
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: interval === "monthly" ? theme.text : "transparent",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: interval === "monthly" ? theme.bg : theme.muted,
              fontWeight: "600",
              fontSize: 13,
            }}
          >
            Mensuel
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setInterval("yearly")}
          testID="abo-yearly"
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: interval === "yearly" ? theme.primary : "transparent",
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: interval === "yearly" ? "#fff" : theme.muted,
              fontWeight: "600",
              fontSize: 13,
            }}
          >
            Annuel −30 %
          </Text>
        </Pressable>
      </View>

      {/* Premium card */}
      <Card
        testID="abo-premium-card"
        style={{
          borderColor: theme.primary,
          borderWidth: 1.5,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
          }}
        >
          <Sparkles color={theme.primary} size={14} />
          <Text
            style={{
              color: theme.primary,
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1,
            }}
          >
            ⭐ POPULAIRE
          </Text>
        </View>
        <Text
          style={{
            color: theme.text,
            fontSize: 20,
            fontWeight: "700",
            marginBottom: 4,
          }}
        >
          PURAMA Aide Premium
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            marginBottom: 4,
          }}
        >
          <Text
            style={{
              color: theme.text,
              fontSize: 36,
              fontWeight: "800",
              letterSpacing: -1,
            }}
            testID="abo-price"
          >
            {(interval === "yearly" ? yearlyEqMonthly : monthly)
              .toFixed(2)
              .replace(".", ",")} €
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginLeft: 6 }}>
            / mois
          </Text>
        </View>
        {interval === "yearly" ? (
          <Text style={{ color: theme.gold, fontSize: 11, marginBottom: 14 }}>
            Facturé {yearly.toFixed(2).replace(".", ",")} € / an · ≈ 4 mois offerts
          </Text>
        ) : (
          <Text style={{ color: theme.dim, fontSize: 11, marginBottom: 14 }}>
            Sans engagement
          </Text>
        )}
        <View style={{ gap: 10, marginBottom: 16 }}>
          {PREMIUM_FEATURES.map((f) => (
            <View
              key={f}
              style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            >
              <Check color={theme.primary} size={16} />
              <Text style={{ color: theme.text, fontSize: 13, flex: 1 }}>
                {f}
              </Text>
            </View>
          ))}
        </View>
        <Button
          testID="abo-premium-cta"
          loading={loading}
          onPress={subscribe}
        >
          Démarrer mes 14 jours gratuits →
        </Button>
      </Card>

      {/* Free card */}
      <View style={{ marginTop: 12 }}>
        <Card testID="abo-free-card">
          <Text
            style={{
              color: theme.text,
              fontSize: 16,
              fontWeight: "700",
              marginBottom: 4,
            }}
          >
            Découverte
          </Text>
          <Text
            style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}
          >
            0 €
          </Text>
          <Text style={{ color: theme.dim, fontSize: 11, marginBottom: 12 }}>
            À vie
          </Text>
          <View style={{ gap: 8 }}>
            {FREE_FEATURES.map((f) => (
              <View
                key={f}
                style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
              >
                <Check color={theme.muted} size={14} />
                <Text style={{ color: theme.muted, fontSize: 12, flex: 1 }}>
                  {f}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      </View>

      <View style={{ marginTop: 16 }}>
        <Button testID="abo-portal" variant="ghost" onPress={openPortal}>
          Gérer mon abonnement →
        </Button>
      </View>
    </Screen>
  );
}
