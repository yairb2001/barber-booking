// ─── StaffCard ────────────────────────────────────────────────────────────────
import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import type { StaffMember } from "@/lib/types";
import type { AppTheme } from "@/lib/theme";

type Props = {
  member: StaffMember;
  theme: AppTheme;
  onPress: () => void;
};

export default function StaffCard({ member, theme, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.divider }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {member.avatarUrl ? (
        <Image source={{ uri: member.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatarPlaceholder, { backgroundColor: theme.bgAlt }]}>
          <Text style={[styles.initial, { color: theme.brand }]}>
            {member.name.charAt(0)}
          </Text>
        </View>
      )}
      <Text style={[styles.name, { color: theme.textPri }]} numberOfLines={1}>
        {member.nickname ?? member.name}
      </Text>
      <Text style={[styles.role, { color: theme.brand }]}>✂️ ספר</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "47%",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 8,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  initial: {
    fontSize: 32,
    fontWeight: "700",
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  role: {
    fontSize: 12,
  },
});
