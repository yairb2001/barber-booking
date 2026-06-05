// ─── Booking Success Screen ───────────────────────────────────────────────────
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Share,
  Animated,
  ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBusiness } from "../_layout";
import { useTheme } from "@/components/ThemeProvider";
import { formatPrice } from "@/lib/theme";

export default function SuccessScreen() {
  const business = useBusiness();
  const theme = useTheme();
  const { slug, mode, name, staffName, serviceName, date, time, price } =
    useLocalSearchParams<{
      slug: string;
      mode: "booked" | "waitlist";
      name: string;
      appointmentId?: string;
      staffName?: string;
      serviceName?: string;
      date?: string;
      time?: string;
      price?: string;
    }>();

  const isWaitlist = mode === "waitlist";

  // Entrance animations
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("he-IL", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    });
  };

  const handleShare = async () => {
    const msg = isWaitlist
      ? `נרשמתי לרשימת המתנה ב${business.name} 💈`
      : `קבעתי תור ב${business.name}!\n📅 ${formatDate(date)} בשעה ${time}\n✂️ ${staffName}\n\nקבע גם אתה: https://barber-booking-indol.vercel.app/book`;
    await Share.share({ message: msg });
  };

  const handleWhatsApp = () => {
    if (!business.phone) return;
    const text = encodeURIComponent(`שלום, אני ${name} ורוצה לשאול על התור שלי ב${business.name}`);
    Linking.openURL(`https://wa.me/${business.phone}?text=${text}`);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      {/* Top gradient strip */}
      <View style={[styles.topStrip, { backgroundColor: theme.brand }]} />

      {/* Icon circle */}
      <View style={styles.iconWrap}>
        <Animated.View
          style={[
            styles.iconCircle,
            { backgroundColor: theme.brand, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Text style={styles.iconEmoji}>{isWaitlist ? "🔔" : "✓"}</Text>
        </Animated.View>
      </View>

      {/* Heading */}
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={[styles.heading, { color: theme.textPri }]}>
          {isWaitlist ? "נרשמת בהצלחה!" : "ההזמנה אושרה!"}
        </Text>
        <Text style={[styles.subheading, { color: theme.textSec }]}>
          {isWaitlist
            ? "נעדכן אותך ברגע שיתפנה תור 🔔"
            : `שלחנו לך אישור ב-WhatsApp\nנשמח לראות אותך! 💈`}
        </Text>

        {/* Summary card */}
        {!isWaitlist && staffName && (
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            {/* Business name header */}
            <View style={[styles.cardHeader, { backgroundColor: theme.brand + "18", borderBottomColor: theme.divider }]}>
              <Text style={[styles.cardBusinessName, { color: theme.brand }]}>{business.name}</Text>
            </View>

            <View style={styles.cardBody}>
              <SummaryRow icon="👤" label="שם"     value={name ?? ""}            theme={theme} />
              <SummaryRow icon="✂️" label="ספר"    value={staffName}              theme={theme} />
              <SummaryRow icon="💇" label="שירות"  value={serviceName ?? ""}      theme={theme} />
              <SummaryRow icon="📅" label="תאריך"  value={formatDate(date)}       theme={theme} />
              <SummaryRow icon="🕐" label="שעה"    value={time ?? ""}             theme={theme} last />
            </View>

            {/* Price badge */}
            {price && (
              <View style={[styles.priceBadge, { backgroundColor: theme.brand }]}>
                <Text style={styles.priceText}>{formatPrice(Number(price))}</Text>
              </View>
            )}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: theme.brand }]}
            onPress={() => router.replace(`/business/${slug}`)}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryBtnText, { color: theme.isDark ? "#0A0A0A" : "#FFFFFF" }]}>
              חזור לדף הבית
            </Text>
          </TouchableOpacity>

          <View style={styles.secondaryRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: theme.brand + "80", backgroundColor: theme.card }]}
              onPress={handleShare}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryIcon}>📤</Text>
              <Text style={[styles.secondaryText, { color: theme.textSec }]}>שתף</Text>
            </TouchableOpacity>

            {business.phone && (
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: "#25D36680", backgroundColor: theme.card }]}
                onPress={handleWhatsApp}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryIcon}>💬</Text>
                <Text style={[styles.secondaryText, { color: theme.textSec }]}>WhatsApp</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

function SummaryRow({
  icon, label, value, theme, last,
}: {
  icon: string;
  label: string;
  value: string;
  theme: { textSec: string; textPri: string; divider: string };
  last?: boolean;
}) {
  return (
    <View style={[sr.row, !last && { borderBottomColor: theme.divider, borderBottomWidth: 1 }]}>
      <View style={sr.left}>
        <Text style={sr.icon}>{icon}</Text>
        <Text style={[sr.label, { color: theme.textSec }]}>{label}</Text>
      </View>
      <Text style={[sr.value, { color: theme.textPri }]}>{value}</Text>
    </View>
  );
}

const sr = StyleSheet.create({
  row: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
  },
  left:  { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  icon:  { fontSize: 15 },
  label: { fontSize: 13 },
  value: { fontSize: 14, fontWeight: "700" },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingBottom: 60 },

  topStrip: { height: 4, width: "100%" },

  iconWrap: { alignItems: "center", marginTop: 48, marginBottom: 24 },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  iconEmoji: { fontSize: 42, color: "#fff", fontWeight: "700" },

  heading: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subheading: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
    paddingHorizontal: 24,
  },

  card: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardHeader: {
    padding: 14,
    alignItems: "center",
    borderBottomWidth: 1,
  },
  cardBusinessName: { fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 },
  priceBadge: {
    margin: 14,
    marginTop: 0,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  priceText: { fontSize: 18, fontWeight: "800", color: "#fff" },

  actions: { paddingHorizontal: 20, gap: 12 },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "700" },

  secondaryRow: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  secondaryIcon: { fontSize: 18 },
  secondaryText: { fontSize: 14, fontWeight: "600" },
});
