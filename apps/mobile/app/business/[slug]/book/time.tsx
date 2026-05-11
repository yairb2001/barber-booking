// ─── Date & Time Selection Screen ────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBusiness } from "../_layout";
import { useTheme } from "@/components/ThemeProvider";
import { getSlots } from "@/lib/api";

// Generate a list of dates starting from today for N days
function generateDates(horizonDays: number): { label: string; value: string }[] {
  const result: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const value = `${yyyy}-${mm}-${dd}`;

    let label: string;
    if (i === 0) label = "היום";
    else if (i === 1) label = "מחר";
    else {
      label = d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
    }
    result.push({ label, value });
  }
  return result;
}

export default function TimeScreen() {
  const business = useBusiness();
  const theme = useTheme();
  const {
    slug, staffId, staffName, staffAvatar,
    serviceId, serviceName, servicePrice, serviceDuration,
  } = useLocalSearchParams<{
    slug: string;
    staffId: string;
    staffName: string;
    staffAvatar?: string;
    serviceId: string;
    serviceName: string;
    servicePrice: string;
    serviceDuration: string;
  }>();

  const horizon = business.bookingHorizonDays ?? 30;
  const dates = generateDates(horizon);

  const [selectedDate, setSelectedDate] = useState(dates[0]?.value ?? "");
  const [slots, setSlots] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadSlots = useCallback(async (date: string) => {
    if (!staffId || !serviceId || !date) return;
    setLoading(true);
    setSlots([]);
    setClosed(false);
    try {
      const res = await getSlots(business.id, staffId, serviceId, date);
      setSlots(res.slots);
      setClosed(res.closed ?? false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [business.id, staffId, serviceId]);

  useEffect(() => {
    if (selectedDate) loadSlots(selectedDate);
  }, [selectedDate, loadSlots]);

  const handleSelectTime = (time: string) => {
    router.push({
      pathname: `/business/${slug}/book/confirm`,
      params: {
        staffId, staffName, staffAvatar: staffAvatar ?? "",
        serviceId, serviceName, servicePrice, serviceDuration,
        date: selectedDate, time,
      },
    });
  };

  const handleWaitlist = () => {
    Alert.alert(
      "רשימת המתנה",
      "לא נמצאו תורים ביום הזה. האם להצטרף לרשימת ההמתנה?",
      [
        { text: "לא", style: "cancel" },
        {
          text: "כן, הצטרף",
          onPress: () => {
            // Navigate to confirm screen in waitlist mode
            router.push({
              pathname: `/business/${slug}/book/confirm`,
              params: {
                staffId, staffName, staffAvatar: staffAvatar ?? "",
                serviceId, serviceName, servicePrice, serviceDuration,
                date: selectedDate, time: "", waitlist: "1",
              },
            });
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.divider }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: theme.brand }]}>→ חזור</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.textPri }]}>בחר תאריך ושעה</Text>
          <Text style={[styles.subtitle, { color: theme.textSec }]}>
            {serviceName} אצל {staffName}
          </Text>
        </View>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Date picker — horizontal scroll */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll}>
          {dates.map((d) => {
            const selected = d.value === selectedDate;
            return (
              <TouchableOpacity
                key={d.value}
                style={[
                  styles.dateChip,
                  {
                    backgroundColor: selected ? theme.brand : theme.card,
                    borderColor: selected ? theme.brand : theme.divider,
                  },
                ]}
                onPress={() => setSelectedDate(d.value)}
              >
                <Text
                  style={[
                    styles.dateLabel,
                    { color: selected ? "#0A0A0A" : theme.textSec },
                  ]}
                >
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Slots */}
        <View style={styles.slotsSection}>
          {loading && (
            <ActivityIndicator color={theme.brand} style={{ marginTop: 30 }} />
          )}

          {!loading && closed && (
            <View style={styles.closedBox}>
              <Text style={[styles.closedText, { color: theme.textMuted }]}>
                🚫 הספר לא עובד ביום הזה
              </Text>
            </View>
          )}

          {!loading && !closed && slots.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                אין תורים פנויים ביום זה
              </Text>
              <TouchableOpacity
                style={[styles.waitlistBtn, { borderColor: theme.brand }]}
                onPress={handleWaitlist}
              >
                <Text style={[styles.waitlistText, { color: theme.brand }]}>
                  🔔 הצטרף לרשימת המתנה
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {!loading && slots.length > 0 && (
            <View style={styles.slotsGrid}>
              {slots.map((time) => (
                <TouchableOpacity
                  key={time}
                  style={[styles.slotChip, { backgroundColor: theme.card, borderColor: theme.brand + "55" }]}
                  onPress={() => handleSelectTime(time)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.slotTime, { color: theme.textPri }]}>{time}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
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
  subtitle: { fontSize: 13, marginTop: 2, textAlign: "center" },
  content: { paddingBottom: 40 },

  dateScroll: { paddingHorizontal: 16, paddingVertical: 14 },
  dateChip: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginLeft: 8,
    borderWidth: 1,
  },
  dateLabel: { fontSize: 14, fontWeight: "600" },

  slotsSection: { paddingHorizontal: 16 },
  slotsGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  slotChip: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
  },
  slotTime: { fontSize: 16, fontWeight: "600" },

  closedBox: { alignItems: "center", paddingTop: 40 },
  closedText: { fontSize: 16 },

  emptyBox: { alignItems: "center", paddingTop: 40, gap: 16 },
  emptyText: { fontSize: 16 },
  waitlistBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  waitlistText: { fontSize: 15, fontWeight: "600" },
});
