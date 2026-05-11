// ─── Confirm + OTP Screen ────────────────────────────────────────────────────
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBusiness } from "../_layout";
import { useTheme } from "@/components/ThemeProvider";
import { sendOtp, verifyOtp, createAppointment, joinWaitlist } from "@/lib/api";
import { formatPrice, formatDuration } from "@/lib/theme";
import OtpInput from "@/components/OtpInput";

type Step = "form" | "otp" | "booking";

const REFERRAL_OPTIONS = [
  { label: "חבר/ה", value: "friend" },
  { label: "אינסטגרם", value: "instagram" },
  { label: "גוגל", value: "google" },
  { label: "שלט/פרסום", value: "sign" },
  { label: "אחר", value: "other" },
];

export default function ConfirmScreen() {
  const business = useBusiness();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    slug: string;
    staffId: string;
    staffName: string;
    staffAvatar?: string;
    serviceId: string;
    serviceName: string;
    servicePrice: string;
    serviceDuration: string;
    date: string;
    time: string;
    waitlist?: string;
  }>();

  const isWaitlist = params.waitlist === "1";

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Format selected date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("he-IL", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    });
  };

  const normalizePhone = (p: string) =>
    p.replace(/\D/g, "").replace(/^0/, "972");

  // Step 1: Send OTP
  const handleSendOtp = async () => {
    if (!name.trim()) { setError("נא להזין שם"); return; }
    if (phone.replace(/\D/g, "").length < 9) { setError("נא להזין מספר טלפון תקין"); return; }
    setError(null);
    setLoading(true);
    try {
      await sendOtp(normalizePhone(phone), business.id);
      setStep("otp");
    } catch (e: unknown) {
      setError((e as Error).message ?? "שגיאה בשליחת קוד");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) { setError("נא להזין קוד בן 6 ספרות"); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await verifyOtp(normalizePhone(phone), otpCode, business.id);
      if (!res.ok) { setError("קוד שגוי, נסה שוב"); return; }
      setOtpToken(res.token);
      setStep("booking");
      // Auto-submit
      await handleBook(res.token);
    } catch (e: unknown) {
      setError((e as Error).message ?? "קוד שגוי");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Create appointment or join waitlist
  const handleBook = async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      if (isWaitlist) {
        await joinWaitlist({
          phone: normalizePhone(phone),
          name: name.trim(),
          staffId: params.staffId,
          serviceId: params.serviceId,
          date: params.date,
          isFlexible: false,
          preferredTimeOfDay: "any",
          businessId: business.id,
        });
        router.replace({
          pathname: `/business/${params.slug}/book/success`,
          params: { mode: "waitlist", name: name.trim() },
        });
      } else {
        const apt = await createAppointment({
          staffId: params.staffId,
          serviceId: params.serviceId,
          date: params.date,
          startTime: params.time,
          customerName: name.trim(),
          customerPhone: normalizePhone(phone),
          referralSource: referralSource || undefined,
          otpToken: token,
          businessId: business.id,
          price: Number(params.servicePrice),
          durationMinutes: Number(params.serviceDuration),
        });
        router.replace({
          pathname: `/business/${params.slug}/book/success`,
          params: {
            mode: "booked",
            appointmentId: apt.id,
            name: name.trim(),
            staffName: params.staffName,
            serviceName: params.serviceName,
            date: params.date,
            time: params.time,
            price: params.servicePrice,
          },
        });
      }
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "שגיאה בהזמנה";
      setError(msg);
      setStep("form"); // go back so user can retry
    } finally {
      setLoading(false);
    }
  };

  const summaryDate = formatDate(params.date);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.bg }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.divider }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Text style={[styles.backText, { color: theme.brand }]}>→ חזור</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.textPri }]}>
            {isWaitlist ? "הצטרפות להמתנה" : "אישור הזמנה"}
          </Text>
          <View style={styles.back} />
        </View>

        {/* Summary card */}
        {!isWaitlist && (
          <View style={[styles.summaryCard, { backgroundColor: theme.card, borderColor: theme.brand + "44" }]}>
            <Row label="ספר" value={params.staffName} theme={theme} />
            <Row label="שירות" value={params.serviceName} theme={theme} />
            <Row label="מחיר" value={formatPrice(Number(params.servicePrice))} theme={theme} />
            <Row label="משך" value={formatDuration(Number(params.serviceDuration))} theme={theme} />
            <Row label="תאריך" value={summaryDate} theme={theme} />
            <Row label="שעה" value={params.time} theme={theme} />
          </View>
        )}

        {/* Form step */}
        {(step === "form" || step === "otp") && (
          <View style={styles.form}>
            <Text style={[styles.sectionLabel, { color: theme.textSec }]}>פרטי לקוח</Text>

            <TextInput
              style={[styles.input, { backgroundColor: theme.card, color: theme.textPri, borderColor: theme.divider }]}
              placeholder="שם מלא"
              placeholderTextColor={theme.textMuted}
              value={name}
              onChangeText={setName}
              textAlign="right"
              editable={step === "form"}
            />

            <TextInput
              style={[styles.input, { backgroundColor: theme.card, color: theme.textPri, borderColor: theme.divider }]}
              placeholder="מספר טלפון"
              placeholderTextColor={theme.textMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              textAlign="left"
              editable={step === "form"}
            />

            {/* Referral source (only show on form) */}
            {step === "form" && (
              <>
                <Text style={[styles.sectionLabel, { color: theme.textSec }]}>איך הגעת אלינו?</Text>
                <View style={styles.referralOptions}>
                  {REFERRAL_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.referralChip,
                        {
                          backgroundColor: referralSource === opt.value ? theme.brand : theme.card,
                          borderColor: referralSource === opt.value ? theme.brand : theme.divider,
                        },
                      ]}
                      onPress={() => setReferralSource(opt.value === referralSource ? "" : opt.value)}
                    >
                      <Text style={{ color: referralSource === opt.value ? "#0A0A0A" : theme.textSec, fontWeight: "600" }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* OTP step */}
            {step === "otp" && (
              <View style={styles.otpSection}>
                <Text style={[styles.otpInfo, { color: theme.textSec }]}>
                  שלחנו קוד אימות ל-{phone}
                </Text>
                <OtpInput
                  value={otpCode}
                  onChange={setOtpCode}
                  theme={theme}
                />
                <TouchableOpacity
                  onPress={() => { setOtpCode(""); setStep("form"); }}
                  style={styles.resendBtn}
                >
                  <Text style={[styles.resendText, { color: theme.brand }]}>לא קיבלתי קוד — שלח שוב</Text>
                </TouchableOpacity>
              </View>
            )}

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            {/* CTA Button */}
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: theme.brand }]}
              onPress={step === "form" ? handleSendOtp : handleVerifyOtp}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#0A0A0A" />
                : <Text style={styles.submitText}>
                    {step === "form" ? "שלח קוד אימות" : "אישור ✅"}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Booking in progress */}
        {step === "booking" && (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.brand} size="large" />
            <Text style={[styles.bookingText, { color: theme.textSec }]}>מקים הזמנה...</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, theme }: { label: string; value: string; theme: { textSec: string; textPri: string; divider: string } }) {
  return (
    <View style={[rowStyles.row, { borderBottomColor: theme.divider }]}>
      <Text style={[rowStyles.value, { color: theme.textPri }]}>{value}</Text>
      <Text style={[rowStyles.label, { color: theme.textSec }]}>{label}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
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
  container: { flex: 1 },
  content: { paddingBottom: 60 },
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

  summaryCard: {
    margin: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },

  form: { padding: 16, gap: 12 },
  sectionLabel: { fontSize: 14, fontWeight: "600", textAlign: "right", marginTop: 8 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  referralOptions: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  referralChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
  },

  otpSection: { gap: 12, alignItems: "center" },
  otpInfo: { fontSize: 14, textAlign: "center" },
  resendBtn: { marginTop: 4 },
  resendText: { fontSize: 13, textDecorationLine: "underline" },

  errorText: {
    color: "#ef4444",
    fontSize: 14,
    textAlign: "center",
    marginTop: 4,
  },

  submitBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: { fontSize: 17, fontWeight: "700", color: "#0A0A0A" },

  centered: { padding: 60, alignItems: "center", gap: 16 },
  bookingText: { fontSize: 16 },
});
