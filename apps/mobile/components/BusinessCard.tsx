// ─── BusinessCard ─────────────────────────────────────────────────────────────
import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import type { Business } from "@/lib/types";

type Props = {
  business: Business;
  onPress: () => void;
};

export default function BusinessCard({ business, onPress }: Props) {
  const brand = business.brandColor || "#D4AF37";

  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: brand + "33" }]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      {/* Cover image */}
      {business.coverImageUrl ? (
        <Image
          source={{ uri: business.coverImageUrl }}
          style={styles.cover}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.coverPlaceholder, { backgroundColor: brand + "22" }]}>
          <Text style={[styles.coverInitial, { color: brand }]}>
            {business.name.charAt(0)}
          </Text>
        </View>
      )}

      {/* Info row */}
      <View style={styles.info}>
        {/* Logo */}
        {business.logoUrl && (
          <Image
            source={{ uri: business.logoUrl }}
            style={[styles.logo, { borderColor: brand }]}
          />
        )}

        <View style={styles.textBlock}>
          <Text style={styles.name}>{business.name}</Text>
          {business.address ? (
            <Text style={styles.address}>{business.address}</Text>
          ) : null}
          {business.about ? (
            <Text style={styles.about} numberOfLines={2}>
              {business.about}
            </Text>
          ) : null}
        </View>

        {/* Brand dot */}
        <View style={[styles.dot, { backgroundColor: brand }]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    marginBottom: 4,
  },
  cover: {
    width: "100%",
    height: 140,
  },
  coverPlaceholder: {
    width: "100%",
    height: 140,
    justifyContent: "center",
    alignItems: "center",
  },
  coverInitial: {
    fontSize: 56,
    fontWeight: "700",
  },
  info: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    padding: 14,
    gap: 12,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
  },
  textBlock: {
    flex: 1,
    alignItems: "flex-end",
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F5F0E1",
    textAlign: "right",
    marginBottom: 2,
  },
  address: {
    fontSize: 13,
    color: "#A8A099",
    textAlign: "right",
    marginBottom: 4,
  },
  about: {
    fontSize: 13,
    color: "#6B6359",
    textAlign: "right",
    lineHeight: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
});
