// ─── Booking Success Screen ───────────────────────────────────────────────────
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Share,
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
      : `קבעתי תור ב${business.name} ל-${formatDate(date)} בשעה ${time} עם ${staffName} ✂️\nקבע גם אתה: ${process.env.EXPO_PUBLIC_APP_URL ?? "https://barber-booking-indol.vercel.app"}/book`;
    await Share.share({ message: msg });
  };

  const handleWhatsApp = () => {
    if (!business.phone) return;
    const text = encodeURIComponent(
      `שלום, רוצה לעדכן על התור שלי ב${business.name}...`
    );
    Linking.openURL(`https://wa.me/${business.phone}?text=${text}`);
  };

  const handleGoHome = () => {
    router.replace(`/business/${slug}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Success icon */}
      <View style={styles.iconWrap}>
        <View style={[styles.iconCircle, { backgroundColor: theme.brand + "22", borderColor: theme.brand + "55" }]}>
          <Text style={styles.icon}>{isWaitlist ? "🔔" : "✅"}</Text>
        </View>
      </View>

      {/* Heading */}
      <Text style={[styles.heading, { color: theme.textPri }]}>
        {isWaitlist ? "נרשמת לרשימת ההמתנה!" : "ההזמנה אושרה!"}
      </Text>
      <Text style={[styles.subheading, { color: theme.textSec }]}>
        {isWaitlist
          ? `שלחנו לך הודעת אישור ב-WhatsApp.\nנעדכן אותך ברגע שיתפנה תור.`
          : `שלחנו לך אישור ב-WhatsApp.\nנשמח לראות אותך!`}
      </Text>

      {/* Summary (for booked mode) */}
      {!isWaitlist && staffName && serviceName && (
        <View style={[styles.summaryCard, { backgroundColor: theme.card, borderColor: theme.divider }]}>
          <SummaryRow label="שם" value={name ?? ""} theme={theme} />
          <SummaryRow label="ספר" value={staffName} theme={theme} />
          <SummaryRow label="שירות" value={serviceName} theme={theme} />
          <SummaryRow label="תאריך" value={formatDate(date)} theme={theme} />
          <SummaryRow label="שעה" value={time ?? ""} theme={theme} />
          {price && <SummaryRow label="מחיר" value={formatPrice(Number(price))} theme={theme} />}
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.brand }]}
          onPress={handleGoHome}
        >
          <Text style={styles.actionBtnText}>חזור לדף הבית ✂️</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.outlineBtn, { borderColor: theme.brand }]}
          onPress={handleShare}
        >
          <Text style={[styles.outlineBtnText, { color: theme.brand }]}>שתף עם חברים 📤</Text>
        </TouchableOpacity>

        {business.phone && (
          <TouchableOpacity
            style={[styles.outlineBtn, { borderColor: "#25D366" }]}
            onPress={handleWhatsApp}
          >
            <Text style={[styles.outlineBtnText, { color: "#25D366" }]}>
              WhatsApp לעסק 💬
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function SummaryRow({ label, value, theme }: { label: string; value: string; theme: { textSec: string; textPri: string; divider: string } }) {
  return (
    <View style={[sr.row, { borderBottomColor: theme.divider }]}>
      <Text style={[sr.value, { color: theme.textPri }]}>{value}</Text>
      <Text style={[sr.label, { color: theme.textSec }]}>{label}</Text>
    </View>
  );
}

const sr = StyleSheet.create({
  row: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: "600" },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    alignItems: "center",
  },
  iconWrap: { marginBottom: 24 },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  icon: { fontSize: 48 },
  heading: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },
  subheading: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  summaryCard: {
    width: "100%",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 28,
  },
  actions: {
    width: "100%",
    gap: 12,
  },
  actionBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0A0A0A",
  },
  outlineBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  outlineBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
