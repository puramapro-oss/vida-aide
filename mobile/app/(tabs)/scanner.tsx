import { useState } from "react";
import { Text, View, Pressable, ActivityIndicator } from "react-native";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { api, ApiError } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Search, CheckCircle2, Sparkles, TrendingUp } from "lucide-react-native";
import * as Haptics from "expo-haptics";

type Emploi =
  | "salarie"
  | "cadre"
  | "independant"
  | "fonctionnaire"
  | "chomeur"
  | "etudiant"
  | "retraite"
  | "frontalier";

type Logement = "locataire" | "proprietaire" | "heberge";
type Famille = "celibataire" | "couple" | "marie" | "divorce";

const EMPLOIS: { id: Emploi; label: string }[] = [
  { id: "salarie", label: "Salarié" },
  { id: "cadre", label: "Cadre" },
  { id: "independant", label: "Indépendant" },
  { id: "fonctionnaire", label: "Fonctionnaire" },
  { id: "chomeur", label: "Chômeur" },
  { id: "etudiant", label: "Étudiant" },
  { id: "retraite", label: "Retraité" },
  { id: "frontalier", label: "Frontalier" },
];

const LOGEMENTS: { id: Logement; label: string }[] = [
  { id: "locataire", label: "Locataire" },
  { id: "proprietaire", label: "Propriétaire" },
  { id: "heberge", label: "Hébergé" },
];

const FAMILLES: { id: Famille; label: string }[] = [
  { id: "celibataire", label: "Célibataire" },
  { id: "couple", label: "Couple" },
  { id: "marie", label: "Marié·e" },
  { id: "divorce", label: "Divorcé·e" },
];

type ScanResult = {
  scan_id: string;
  results: Array<{
    category: string;
    title: string;
    description: string;
    amount: number;
    frequency: "monthly" | "yearly" | "one_time";
  }>;
  total_recoverable: number;
  total_recoverable_monthly: number;
  summary?: string;
};

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.primary : "rgba(255,255,255,0.12)",
        backgroundColor: active
          ? "rgba(16,185,129,0.18)"
          : "rgba(255,255,255,0.04)",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: active ? theme.primary : theme.muted,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function ScannerScreen() {
  const [emploi, setEmploi] = useState<Emploi | null>(null);
  const [revenus, setRevenus] = useState("");
  const [logement, setLogement] = useState<Logement | null>(null);
  const [loyer, setLoyer] = useState("");
  const [famille, setFamille] = useState<Famille | null>(null);
  const [enfants, setEnfants] = useState("");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const canSubmit = emploi && revenus && logement && !loading;

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const body = {
        situation: {
          emploi,
          revenus_mensuels_nets: Number(revenus) || undefined,
          logement,
          loyer_mensuel: loyer ? Number(loyer) : undefined,
          famille: famille ?? undefined,
          enfants: enfants ? Number(enfants) : undefined,
          age: age ? Number(age) : undefined,
          region: region || undefined,
        },
      };
      const data = await api<ScanResult>("/api/scan", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {}
      );
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : "AideIA est indisponible un instant. Réessaie.";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {}
      );
    } finally {
      setLoading(false);
    }
  }

  function resetScan() {
    setResult(null);
    setError(null);
  }

  if (result) {
    return (
      <Screen>
        <View style={{ marginBottom: 16, marginTop: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <CheckCircle2 color={theme.primary} size={18} />
            <Text
              style={{ color: theme.primary, fontSize: 12, letterSpacing: 1.5 }}
            >
              SCAN TERMINÉ
            </Text>
          </View>
          <Text
            style={{
              color: theme.text,
              fontSize: 32,
              fontWeight: "800",
              marginTop: 4,
              letterSpacing: -1,
            }}
            testID="scan-total"
          >
            {result.total_recoverable.toLocaleString("fr-FR")} €
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 4 }}>
            {result.results.length} aides et droits détectés ·{" "}
            {result.total_recoverable_monthly.toFixed(0)} €/mois récurrent
          </Text>
        </View>

        {result.summary ? (
          <Card testID="scan-summary-card">
            <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}>
              {result.summary}
            </Text>
          </Card>
        ) : null}

        <View style={{ gap: 10, marginTop: 12 }}>
          {result.results.map((r, i) => (
            <Card key={`${r.title}-${i}`} testID={`scan-result-${i}`}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(16,185,129,0.18)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <TrendingUp color={theme.primary} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: theme.dim,
                        fontSize: 10,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                      }}
                    >
                      {r.category}
                    </Text>
                    <Text
                      style={{
                        color: theme.gold,
                        fontSize: 16,
                        fontWeight: "700",
                      }}
                    >
                      {r.amount.toLocaleString("fr-FR")} €
                      {r.frequency === "monthly"
                        ? "/mois"
                        : r.frequency === "yearly"
                          ? "/an"
                          : ""}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: 15,
                      fontWeight: "600",
                      marginTop: 2,
                    }}
                  >
                    {r.title}
                  </Text>
                  <Text
                    style={{
                      color: theme.muted,
                      fontSize: 12,
                      marginTop: 4,
                      lineHeight: 17,
                    }}
                  >
                    {r.description}
                  </Text>
                </View>
              </View>
            </Card>
          ))}
        </View>

        <View style={{ marginTop: 20 }}>
          <Button
            testID="scan-new"
            variant="secondary"
            onPress={resetScan}
          >
            Lancer un nouveau scan
          </Button>
        </View>
      </Screen>
    );
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
          <Search color={theme.primary} size={18} />
          <Text
            style={{ color: theme.primary, fontSize: 12, letterSpacing: 1.5 }}
          >
            SCANNER FINANCIER
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
          Ta situation en 2 minutes.
        </Text>
        <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
          AideIA analyse 200+ aides, optimisations et droits oubliés.
        </Text>
      </View>

      <Card testID="scanner-emploi-card">
        <Text
          style={{
            color: theme.muted,
            fontSize: 11,
            letterSpacing: 1,
            marginBottom: 10,
            textTransform: "uppercase",
          }}
        >
          Ta situation pro
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EMPLOIS.map((e) => (
            <Chip
              key={e.id}
              label={e.label}
              active={emploi === e.id}
              onPress={() => setEmploi(e.id)}
              testID={`scanner-emploi-${e.id}`}
            />
          ))}
        </View>
      </Card>

      <View style={{ marginTop: 10 }}>
        <Input
          label="Revenus nets mensuels (€)"
          value={revenus}
          onChangeText={setRevenus}
          keyboardType="numeric"
          placeholder="Ex: 2100"
          testID="scanner-revenus"
        />
      </View>

      <Card testID="scanner-logement-card">
        <Text
          style={{
            color: theme.muted,
            fontSize: 11,
            letterSpacing: 1,
            marginBottom: 10,
            textTransform: "uppercase",
          }}
        >
          Logement
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {LOGEMENTS.map((l) => (
            <Chip
              key={l.id}
              label={l.label}
              active={logement === l.id}
              onPress={() => setLogement(l.id)}
              testID={`scanner-logement-${l.id}`}
            />
          ))}
        </View>
      </Card>

      {logement === "locataire" ? (
        <View style={{ marginTop: 10 }}>
          <Input
            label="Loyer mensuel (€)"
            value={loyer}
            onChangeText={setLoyer}
            keyboardType="numeric"
            placeholder="Ex: 650"
            testID="scanner-loyer"
          />
        </View>
      ) : null}

      <Card testID="scanner-famille-card">
        <Text
          style={{
            color: theme.muted,
            fontSize: 11,
            letterSpacing: 1,
            marginBottom: 10,
            textTransform: "uppercase",
          }}
        >
          Famille
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {FAMILLES.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              active={famille === f.id}
              onPress={() => setFamille(f.id)}
              testID={`scanner-famille-${f.id}`}
            />
          ))}
        </View>
      </Card>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Enfants"
            value={enfants}
            onChangeText={setEnfants}
            keyboardType="numeric"
            placeholder="0"
            testID="scanner-enfants"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Âge"
            value={age}
            onChangeText={setAge}
            keyboardType="numeric"
            placeholder="Ex: 32"
            testID="scanner-age"
          />
        </View>
      </View>

      <View style={{ marginTop: 10 }}>
        <Input
          label="Région / Département"
          value={region}
          onChangeText={setRegion}
          placeholder="Ex: Doubs, Paris, Occitanie"
          testID="scanner-region"
        />
      </View>

      {error ? (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            backgroundColor: "rgba(239,68,68,0.12)",
            borderWidth: 1,
            borderColor: "rgba(239,68,68,0.3)",
          }}
        >
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 20 }}>
        <Button
          testID="scanner-submit"
          onPress={submit}
          loading={loading}
          disabled={!canSubmit}
        >
          {loading ? "Scan en cours…" : "Lancer le scan →"}
        </Button>
        {loading ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 12,
            }}
          >
            <ActivityIndicator color={theme.primary} size="small" />
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              AideIA analyse 200+ aides · 10 à 30 secondes
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
