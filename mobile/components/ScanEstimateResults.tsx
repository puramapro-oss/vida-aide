import { Text, View } from "react-native";
import { CheckCircle2, TrendingUp } from "lucide-react-native";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { theme } from "@/lib/theme";
import type { ScanEstimateResponse } from "@/lib/scan";

export default function ScanEstimateResults({ result, onReset }: { result: ScanEstimateResponse; onReset: () => void }) {
  return (
    <Screen>
      <View style={{ marginBottom: 16, marginTop: 8 }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, }}
        >
          <CheckCircle2 color={theme.primary} size={18} />
          <Text
            style={{ color: theme.primary, fontSize: 12, letterSpacing: 1.5 }}
          >
            ESTIMATION ENREGISTRÉE
          </Text>
        </View>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 6 }}>Total indicatif sur un an, aides ponctuelles comprises</Text>
        <Text
          style={{ color: theme.text, fontSize: 32, fontWeight: "800", marginTop: 4, letterSpacing: -1, }}
          testID="scan-total"
        >
          {result.total_recoverable.toLocaleString("fr-FR")} €
        </Text>
        <Text style={{ color: theme.muted, fontSize: 13, marginTop: 4 }}>
          {result.results.length} pistes d’aides · estimation mensuelle :{" "}
          {result.total_recoverable_monthly.toFixed(0)} €/mois
        </Text>
        <Text style={{ color: theme.muted, fontSize: 13, marginTop: 8 }}>
          Estimation indicative de l’IA, non vérifiée. Éligibilité, montants, cumulabilité et récurrence à confirmer auprès des organismes ; aucun versement attesté.
        </Text>
        {result.warnings?.length ? <Text style={{ color: theme.gold, fontSize: 12, marginTop: 8 }}>Le scan est enregistré. Certaines mises à jour du profil ou des notifications restent indisponibles.</Text> : null}
      </View>

      {result.summary ? (
        <Card testID="scan-summary-card">
          <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}>
            Synthèse proposée par l’IA, à vérifier : {result.summary}
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: 10, marginTop: 12 }}>
        {result.results.map((r, i) => (
          <Card key={`${r.aide}-${i}`} testID={`scan-result-${i}`}>
            <View
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, }}
            >
              <View
                style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(16,185,129,0.18)", alignItems: "center", justifyContent: "center", }}
              >
                <TrendingUp color={theme.primary} size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <View
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", }}
                >
                  <Text
                    style={{ color: theme.dim, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", }}
                  >
                    {r.category}
                  </Text>
                  <Text
                    style={{ color: theme.gold, fontSize: 16, fontWeight: "700", }}
                  >
                    Estimation : {r.montant_estime.toLocaleString("fr-FR")} €
                    {r.unite === 'unique' ? ' ponctuels' : `/${r.unite}`}
                  </Text>
                </View>
                <Text
                  style={{ color: theme.text, fontSize: 15, fontWeight: "600", marginTop: 2, }}
                >
                  {r.aide}
                </Text>
                <Text
                  style={{ color: theme.muted, fontSize: 12, marginTop: 4, lineHeight: 17, }}
                >
                  {r.organisme} · Éligibilité proposée : {r.eligibilite}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>Conditions à vérifier : {r.conditions.length ? r.conditions.join(' · ') : 'non précisées'}. {r.demarche}</Text>
              </View>
            </View>
          </Card>
        ))}
      </View>

      <View style={{ marginTop: 20 }}>
        <Button
          testID="scan-new"
          variant="secondary"
          onPress={onReset}
        >
          Lancer un nouveau scan
        </Button>
      </View>
    </Screen>
  );
}
