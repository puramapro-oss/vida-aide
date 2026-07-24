import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://auth.purama.dev";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_ANON_KEY) {
  console.warn(
    "[vidaaide] EXPO_PUBLIC_SUPABASE_ANON_KEY manquant. Auth ne fonctionnera pas."
  );
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof globalThis === "undefined" || !(globalThis as any).localStorage) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof globalThis === "undefined" || !(globalThis as any).localStorage) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof globalThis === "undefined" || !(globalThis as any).localStorage) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const APP_SCHEMA = "vida_aide";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === "web",
      flowType: "pkce",
    },
    db: { schema: APP_SCHEMA },
  }
);
