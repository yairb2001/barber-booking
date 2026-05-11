// ─── My Bookings Screen ───────────────────────────────────────────────────────
// Customer views their upcoming and past appointments.
// Auth: OTP via phone (same flow as booking) — token stored in component state.

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { sendOtp, verifyOtp, getMyAppointments } from "@/lib/api";
import type { Appointment } from "@/lib/types";
import OtpInput from "@/components/OtpInput";
import { THEMES } from "@/lib/theme";

// Use the default onyx theme (this screen lives outside any business context)
const theme = THEMES["onyx"];

type AuthStep = "phone" | "otp" | "done";

export default function MyBookingsScreen() {
  const [authStep, setAuthStep] = useState<AuthStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [past, setPast] = useState<Appointment[]>([]);

  const normalize = (p: string) => p.replace(/\D/g, "").replace(/^0/, "972");

  const handleSendOtp = async () => {
    if (phone.replace(/\D/g, "").length < 9) {
      setError("נא להזין מספר טלפון תקין");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Send OTP without businessId — backend uses findFirst (works for single-tenant)
      await sendOtp(normalize(phone), "");
      setAuthStep("otp");
    } catch (e: unknown) {
      setError((e as Error).message ?? "שגיאה");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 6) { setError("נא להזין קוד בן 6 ספרות"); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await verifyOtp(normalize(phone), otp, "");
      setToken(res.token);
      const data = await getMyAppointments(normalize(phone), res.token);
      setUpcoming(data.upcoming);
      setPast(data.past);
      setAuthStep("done");
    } catch (e: unknown) {
      setError((e as Error).message ?? "קוד שגוי");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("he-IL", {
      weekday: "short", day: "numeric", month: "long",
    });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textPri }]}>התורים שלי</Text>
      </View>

      {/* Auth: phone input */}
      {authStep === "phone" && (
        <View style={styles.authBox}>
          <Text style={[styles.authInfo, { color: theme.textSec }]}>
            הזן את מספר הטלפון שלך כדי לצפות בתורים
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.card, color: theme.textPri, borderColor: theme.divider }]}
            placeholder="מספר טלפון"
            placeholderTextColor={theme.textMuted}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textAlign="right"
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.brand }]}
            onPress={handleSendOtp}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#0A0A0A" /> : (
              <Text style={styles.btnText}>שלח קוד אימות</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Auth: OTP input */}
      {authStep === "otp" && (
        <View style={styles.authBox}>
          <Text style={[styles.authInfo, { color: theme.textSec }]}>
            הזן את הקוד שנשלח ל-{phone}
          </Text>
          <OtpInput value={otp} onChange={setOtp} theme={theme} />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.brand }]}
            onPress={handleVerifyOtp}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#0A0A0A" /> : (
              <Text style={styles.btnText}>כניסה</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setAuthStep("phone"); setOtp(""); }}>
            <Text style={[styles.back, { color: theme.brand }]}>← חזור</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Appointments list */}
      {authStep === "done" && (
        <View style={styles.listSection}>
          {/* Upcoming */}
          <Text style={[styles.sectionTitle, { color: theme.textPri }]}>⏰ תורים קרובים</Text>
          {upcoming.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>אין תורים קרובים</Text>
          ) : (
            upcoming.map((apt) => (
              <AppointmentCard key={apt.id} apt={apt} theme={theme} upcoming />
            ))
          )}

          <View style={styles.divider} />

          {/* Past */}
          <Text style={[styles.sectionTitle, { color: theme.textPri }]}>📋 היסטוריה</Text>
          {past.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>אין היסטוריה</Text>
          ) : (
            past.slice(0, 10).map((apt) => (
              <AppointmentCard key={apt.id} apt={apt} theme={theme} upcoming={false} />
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function AppointmentCard({
  apt,
  theme,
  upcoming,
}: {
  apt: Appointment;
  theme: typeof THEMES[keyof typeof THEMES];
  upcoming: boolean;
}) {
  const d = new Date(apt.date);
  const dateLabel = d.toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <View
      style={[
        cardStyles.card,
        {
          backgroundColor: theme.card,
          borderColor: upcoming ? theme.brand + "55" : theme.divider,
        },
      ]}
    >
      <View style={cardStyles.row}>
        <Text style={[cardStyles.date, { color: upcoming ? theme.brand : theme.textSec }]}>
          {dateLabel}
        </Text>
        <Text style={[cardStyles.time, { color: theme.textPri }]}>{apt.startTime}</Text>
      </View>
      <Text style={[cardStyles.staff, { color: theme.textPri }]}>
        ✂️ {apt.staff.name} — {apt.service.name}
      </Text>
      <Text style={[cardStyles.price, { color: theme.textMuted }]}>
        ₪{apt.price}
      </Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 6,
  },
  row: { flexDirection: "row-reverse", justifyContent: "space-between" },
  date: { fontSize: 14, fontWeight: "600" },
  time: { fontSize: 14, fontWeight: "700" },
  staff: { fontSize: 15, fontWeight: "600", textAlign: "right" },
  price: { fontSize: 13, textAlign: "right" },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 60 },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontSize: 28, fontWeight: "700", textAlign: "right" },

  authBox: { padding: 20, gap: 14 },
  authInfo: { fontSize: 15, textAlign: "right", lineHeight: 22 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  errorText: { color: "#ef4444", fontSize: 14, textAlign: "center" },
  btn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { fontSize: 16, fontWeight: "700", color: "#0A0A0A" },
  back: { textAlign: "center", fontSize: 14, marginTop: 4 },

  listSection: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "700", textAlign: "right", marginBottom: 12 },
  emptyText: { fontSize: 14, textAlign: "center", paddingVertical: 12 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: 20 },
});
