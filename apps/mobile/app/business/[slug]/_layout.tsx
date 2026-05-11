// ─── Business Layout — loads and injects the business theme ───────────────────
// All screens under business/[slug]/ share this layout.
// It fetches the business data and sets the theme context before rendering.

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getBusiness } from "@/lib/api";
import type { Business } from "@/lib/types";
import { resolveTheme } from "@/lib/theme";

// Shared context so child screens can access the full business object
import { createContext, useContext } from "react";

export const BusinessContext = createContext<Business | null>(null);
export function useBusiness(): Business {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness must be used within a business route");
  return ctx;
}

export default function BusinessLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    getBusiness(slug)
      .then(setBusiness)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading || !business) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#D4AF37" size="large" />
      </View>
    );
  }

  const theme = resolveTheme(business.theme);

  return (
    <ThemeProvider initialTheme={theme}>
      <BusinessContext.Provider value={business}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.bg },
          }}
        />
      </BusinessContext.Provider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0A0A0A",
  },
});
