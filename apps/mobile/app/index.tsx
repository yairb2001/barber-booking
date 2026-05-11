// ─── Business Discovery Screen ────────────────────────────────────────────────
// Shows all businesses registered on the platform.
// The user taps a card to enter that business's booking flow.

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  I18nManager,
} from "react-native";
import { router } from "expo-router";
import { getBusinesses } from "@/lib/api";
import type { Business } from "@/lib/types";
import BusinessCard from "@/components/BusinessCard";

// Force RTL (Hebrew)
I18nManager.forceRTL(true);

export default function DiscoveryScreen() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getBusinesses()
      .then(setBusinesses)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = businesses.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.address ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>בחר ספרייה</Text>
        <TextInput
          style={styles.search}
          placeholder="חיפוש..."
          placeholderTextColor="#6B6359"
          value={search}
          onChangeText={setSearch}
          textAlign="right"
        />
      </View>

      {/* Content */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color="#D4AF37" size="large" />
        </View>
      )}

      {error && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>שגיאה בטעינת הנתונים</Text>
          <Text style={styles.errorSub}>{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          numColumns={1}
          renderItem={({ item }) => (
            <BusinessCard
              business={item}
              onPress={() => router.push(`/business/${item.slug}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>לא נמצאו ספריות</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "#0A0A0A",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(212,175,55,0.15)",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#F5F0E1",
    textAlign: "right",
    marginBottom: 12,
  },
  search: {
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: "#F5F0E1",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.2)",
  },
  list: {
    padding: 16,
    gap: 12,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorText: {
    color: "#F5F0E1",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  errorSub: {
    color: "#6B6359",
    fontSize: 14,
    textAlign: "center",
  },
  emptyText: {
    color: "#6B6359",
    fontSize: 16,
    textAlign: "center",
  },
});
