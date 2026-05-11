// ─── Service Selection Screen ─────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBusiness } from "../_layout";
import { useTheme } from "@/components/ThemeProvider";
import { getServices } from "@/lib/api";
import type { Service } from "@/lib/types";
import { formatPrice, formatDuration } from "@/lib/theme";

export default function ServiceScreen() {
  const business = useBusiness();
  const theme = useTheme();
  const { slug, staffId, staffName, staffAvatar } =
    useLocalSearchParams<{
      slug: string;
      staffId: string;
      staffName: string;
      staffAvatar?: string;
    }>();

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServices(business.id, staffId)
      .then(setServices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [business.id, staffId]);

  const handleSelect = (service: Service) => {
    const price = service.customPrice ?? service.price;
    const duration = service.customDuration ?? service.durationMinutes;
    router.push({
      pathname: `/business/${slug}/book/time`,
      params: {
        staffId,
        staffName,
        staffAvatar: staffAvatar ?? "",
        serviceId: service.id,
        serviceName: service.name,
        servicePrice: String(price),
        serviceDuration: String(duration),
      },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.divider }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: theme.brand }]}>→ חזור</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.textPri }]}>בחר שירות</Text>
          {staffName && (
            <Text style={[styles.subtitle, { color: theme.textSec }]}>אצל {staffName}</Text>
          )}
        </View>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={services}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const price = item.customPrice ?? item.price;
            const duration = item.customDuration ?? item.durationMinutes;
            return (
              <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.card, borderColor: theme.divider }]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.85}
              >
                <View style={styles.cardRight}>
                  {item.icon && <Text style={styles.icon}>{item.icon}</Text>}
                  <View style={styles.textBlock}>
                    <Text style={[styles.serviceName, { color: theme.textPri }]}>
                      {item.name}
                    </Text>
                    {item.description && (
                      <Text style={[styles.desc, { color: theme.textSec }]} numberOfLines={2}>
                        {item.description}
                      </Text>
                    )}
                    <View style={styles.meta}>
                      {item.showDuration && (
                        <Text style={[styles.metaText, { color: theme.textMuted }]}>
                          ⏱ {formatDuration(duration)}
                        </Text>
                      )}
                      {item.note && (
                        <Text style={[styles.noteText, { color: theme.textMuted }]}>
                          {item.note}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
                <Text style={[styles.price, { color: theme.brand }]}>{formatPrice(price)}</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.empty, { color: theme.textMuted }]}>אין שירותים זמינים</Text>
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
  headerText: { alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  list: { padding: 16, gap: 10 },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardRight: { flexDirection: "row-reverse", alignItems: "center", flex: 1, gap: 12 },
  icon: { fontSize: 28 },
  textBlock: { flex: 1, alignItems: "flex-end" },
  serviceName: { fontSize: 16, fontWeight: "700", textAlign: "right", marginBottom: 2 },
  desc: { fontSize: 13, textAlign: "right", lineHeight: 18, marginBottom: 4 },
  meta: { flexDirection: "row-reverse", gap: 8, flexWrap: "wrap" },
  metaText: { fontSize: 12 },
  noteText: { fontSize: 12, fontStyle: "italic" },
  price: { fontSize: 18, fontWeight: "700", marginLeft: 8 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 40 },
  empty: { fontSize: 16 },
});
