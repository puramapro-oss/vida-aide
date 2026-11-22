import { useEffect, useState } from "react";
import { Text, View, Pressable, ActivityIndicator } from "react-native";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { inputNumber, ScanValidationError } from "@/lib/scan";
import { scanContent, type ScanPayload } from "@/lib/scan-attempt";
import { useScanRequest } from "@/hooks/useScanRequest";
import { useAuth } from "@/store/auth";
import { theme } from "@/lib/theme";
import { Search } from "lucide-react-native";
import ScanEstimateResults from "@/components/ScanEstimateResults";
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

function Chip({
  label,
  active,
  onPress,
  testID,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
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
      <Text style={{ color: active ? theme.primary : theme.muted, fontSize: 13, fontWeight: "600", }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ScannerScreen() {
  const userId = useAuth((state) => state.user?.id);
  return <ScannerForm key={userId ?? 'signed-out'} userId={userId} />;
}

function ScannerForm({ userId }: { userId?: string }) {
  const [emploi, setEmploi] = useState<Emploi | null>(null);
  const [revenus, setRevenus] = useState("");
  const [logement, setLogement] = useState<Logement | null>(null);
  const [loyer, setLoyer] = useState("");
  const [famille, setFamille] = useState<Famille | null>(null);
  const [enfants, setEnfants] = useState("");
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const { loading, ready, preparing, error, setError, result, restored, attempt, submit: send, reset } = useScanRequest(userId);
  const [appliedRestore, setAppliedRestore] = useState<ScanPayload | null>(null);
  useEffect(() => {
    if (!restored || restored.type !== 'financial') return;
    const situation = restored.situation;
    const numberText = (value: unknown) => typeof value === 'number' ? String(value) : '';
    setEmploi(EMPLOIS.some((entry) => entry.id === situation.emploi) ? situation.emploi as Emploi : null);
    setLogement(LOGEMENTS.some((entry) => entry.id === situation.logement) ? situation.logement as Logement : null);
    setFamille(FAMILLES.some((entry) => entry.id === situation.famille) ? situation.famille as Famille : null);
    setRevenus(numberText(situation.revenus_mensuels_nets)); setLoyer(numberText(situation.loyer_mensuel));
    setEnfants(numberText(situation.enfants)); setAge(numberText(situation.age));
    setRegion(typeof situation.region === 'string' ? situation.region : '');
    setAppliedRestore(restored);
  }, [restored]);
  const formReady = ready && (!restored || appliedRestore === restored);
  const canSubmit = Boolean(userId && formReady && emploi && revenus.trim() && logement && !loading);
  function payload(): ScanPayload {
    if (region.length > 80) throw new ScanValidationError('Région : limite de 80 caractères.');
    return { type: 'financial', situation: {
      emploi, revenus_mensuels_nets: inputNumber(revenus, 'Revenus', 1_000_000), logement,
      loyer_mensuel: logement === 'locataire' ? inputNumber(loyer, 'Loyer', 50_000) : undefined,
      famille: famille ?? undefined, enfants: inputNumber(enfants, 'Enfants', 20, true),
      age: inputNumber(age, 'Âge', 120, true, 16), region: region || undefined,
    } };
  }
  let sameContent = false;
  try { sameContent = attempt?.content === scanContent(payload()); } catch { /* The submit handler reports incomplete input. */ }
  async function submit() {
    if (!canSubmit) return;
    try { await send(payload()); }
    catch (cause) { setError(cause instanceof ScanValidationError ? cause.message : 'Les données saisies sont invalides.'); }
  }
  if (result) return <ScanEstimateResults result={result} onReset={() => { void reset(); }} />;

  return (
    <Screen>
      <View style={{ marginBottom: 20, marginTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, }}>
          <Search color={theme.primary} size={18} />
          <Text style={{ color: theme.primary, fontSize: 12, letterSpacing: 1.5 }}>
            SCANNER FINANCIER
          </Text>
        </View>
        <Text style={{ color: theme.text, fontSize: 26, fontWeight: "700", marginTop: 4, }}>
          Une estimation pour ta situation.
        </Text>
        <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
          AideIA propose des pistes d’aides et de droits à vérifier auprès des organismes.
        </Text>
      </View>

      <Card testID="scanner-emploi-card">
        <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase", }}>
          Ta situation pro
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EMPLOIS.map((e) => (
            <Chip
              key={e.id}
              disabled={loading || !formReady}
              label={e.label}
              active={emploi === e.id}
              onPress={() => setEmploi(e.id)}
              testID={`scanner-emploi-${e.id}`}
            />
          ))}
        </View>
      </Card>

      <View style={{ marginTop: 10 }}>
        <Input editable={!loading && formReady} label="Revenus nets mensuels (€)" value={revenus} onChangeText={setRevenus} keyboardType="numeric" placeholder="Ex: 2100" testID="scanner-revenus" />
      </View>

      <Card testID="scanner-logement-card">
        <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase", }}>
          Logement
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {LOGEMENTS.map((l) => (
            <Chip
              key={l.id}
              disabled={loading || !formReady}
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
          <Input editable={!loading && formReady} label="Loyer mensuel (€)" value={loyer} onChangeText={setLoyer} keyboardType="numeric" placeholder="Ex: 650" testID="scanner-loyer" />
        </View>
      ) : null}

      <Card testID="scanner-famille-card">
        <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase", }}>
          Famille
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {FAMILLES.map((f) => (
            <Chip
              key={f.id}
              disabled={loading || !formReady}
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
          <Input editable={!loading && formReady} label="Enfants" value={enfants} onChangeText={setEnfants} keyboardType="numeric" placeholder="0" testID="scanner-enfants" />
        </View>
        <View style={{ flex: 1 }}>
          <Input editable={!loading && formReady} label="Âge" value={age} onChangeText={setAge} keyboardType="numeric" placeholder="Ex: 32" testID="scanner-age" />
        </View>
      </View>

      <View style={{ marginTop: 10 }}>
        <Input editable={!loading && formReady} label="Région / Département" value={region} onChangeText={setRegion} placeholder="Ex: Doubs, Paris, Occitanie" testID="scanner-region" />
      </View>

      {error ? (
        <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 16 }}>En gratuit, chaque nouvelle demande, même échouée ou incertaine, compte dans la limite de 5 scans par 24 h. Reprendre la même demande ne relance pas le modèle. Modifier le contenu crée une nouvelle demande. Ce décompte ne déclenche aucun paiement.</Text>
      {attempt || !ready ? <Button testID="scanner-new-intent" variant="secondary" disabled={loading || preparing || !userId} onPress={() => { void reset(); }}>Préparer une nouvelle demande</Button> : null}
      {!formReady && !error ? <Text style={{ color: theme.muted, marginTop: 8 }}>{userId ? 'Lecture de la demande conservée…' : 'Connexion requise.'}</Text> : null}
      <View style={{ marginTop: 20 }}>
        <Button
          testID="scanner-submit"
          onPress={submit}
          loading={loading}
          disabled={!canSubmit}
        >
          {loading ? "Scan en cours…" : sameContent ? "Reprendre cette demande →" : "Lancer un nouveau scan →"}
        </Button>
        {loading ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, }}>
            <ActivityIndicator color={theme.primary} size="small" />
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              Préparation d’une estimation indicative…
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
