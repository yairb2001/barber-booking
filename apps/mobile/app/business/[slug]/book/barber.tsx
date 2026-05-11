// ─── Barber Selection Screen ──────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBusiness } from "../_layout";
import { useTheme } from "@/components/ThemeProvider";
import { getStaff } from "@/lib/api";
import type { StaffMember } from "@/lib/types";

export default function BarberScreen() {
  const business = useBusiness();
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStaff(business.id)
      .then(setStaff)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [business.id]);

  const handleSelect = (member: StaffMember) => {
    router.push({
      pathname: `/business/${slug}/book/service`,
      params: { staffId: member.id, staffName: member.name, staffAvatar: member.avatarUrl ?? "" },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.divider }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: theme.brand }]}>→ חזור</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.textPri }]}>בחר ספר</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={staff}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.divider }]}
              onPress={() => handleSelect(item)}
              activeOpacity={0.8}
            >
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: theme.bgAlt }]}>
                  <Text style={[styles.initial, { color: theme.brand }]}>
                    {item.name.charAt(0)}
                  </Text>
                </View>
              )}
              <Text style={[styles.name, { color: theme.textPri }]} numberOfLines={1}>
                {item.nickname ?? item.name}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.empty, { color: theme.textMuted }]}>אין ספרים זמינים</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  back: { width: 60 },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 20, fontWeight: "700" },
  list: { padding: 16 },
  row: { gap: 12, marginBottom: 12 },
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
  },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 10 },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  initial: { fontSize: 36, fontWeight: "700" },
  name: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 40 },
  empty: { fontSize: 16 },
});
