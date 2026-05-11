// ─── Profile Screen ───────────────────────────────────────────────────────────
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { router } from "expo-router";
import { THEMES } from "@/lib/theme";

const theme = THEMES["onyx"];

const APP_VERSION = "1.0.0";

export default function ProfileScreen() {
  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textPri }]}>הגדרות</Text>
      </View>

      {/* Quick links */}
      <View style={styles.section}>
        <MenuItem
          icon="📅"
          label="התורים שלי"
          onPress={() => router.push("/my-bookings")}
          theme={theme}
        />
        <MenuItem
          icon="💬"
          label="WhatsApp תמיכה"
          onPress={() => Linking.openURL("https://wa.me/972500000000")}
          theme={theme}
        />
        <MenuItem
          icon="🌐"
          label="ספריות"
          onPress={() => router.push("/")}
          theme={theme}
        />
      </View>

      {/* Version */}
      <View style={styles.footer}>
        <Text style={[styles.version, { color: theme.textMuted }]}>
          גרסה {APP_VERSION}
        </Text>
      </View>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  theme,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  theme: typeof THEMES[keyof typeof THEMES];
}) {
  return (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: theme.card, borderColor: theme.divider }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.itemLabel, { color: theme.textPri }]}>{label}</Text>
      <Text style={styles.itemIcon}>{icon}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 28, fontWeight: "700", textAlign: "right" },
  section: { padding: 16, gap: 10 },
  item: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemIcon: { fontSize: 22 },
  itemLabel: { fontSize: 16, fontWeight: "600" },
  footer: { alignItems: "center", paddingTop: 40 },
  version: { fontSize: 13 },
});
