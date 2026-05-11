// ─── Business Home Screen ─────────────────────────────────────────────────────
// Shows the business hero, quick slots carousel, and staff grid.

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useBusiness } from "./_layout";
import { useTheme } from "@/components/ThemeProvider";
import { getQuickSlots, getAnnouncements } from "@/lib/api";
import type { QuickSlot, Announcement } from "@/lib/types";
import { formatPrice, formatDuration } from "@/lib/theme";
import StaffCard from "@/components/StaffCard";
import { getStaff } from "@/lib/api";
import type { StaffMember } from "@/lib/types";

export default function BusinessHomeScreen() {
  const business = useBusiness();
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [slotsData, staffData, announcementsData] = await Promise.all([
        getQuickSlots(business.id),
        getStaff(business.id),
        getAnnouncements(business.id),
      ]);
      setQuickSlots(slotsData);
      setStaff(staffData);
      setAnnouncements(announcementsData);
    } catch (e) {
      console.error("Failed to load business home data:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [business.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleBookNow = () => {
    router.push(`/business/${slug}/book/barber`);
  };

  const handleQuickSlot = (slot: QuickSlot) => {
    router.push({
      pathname: `/business/${slug}/book/confirm`,
      params: {
        staffId: slot.staffId,
        staffName: slot.staffName,
        staffAvatar: slot.staffAvatar ?? "",
        serviceId: slot.serviceId,
        serviceName: slot.serviceName,
        servicePrice: String(slot.price),
        serviceDuration: String(slot.duration),
        date: slot.date,
        time: slot.time,
      },
    });
  };

  const handleStaffPress = (member: StaffMember) => {
    router.push({
      pathname: `/business/${slug}/book/service`,
      params: { staffId: member.id, staffName: member.name },
    });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.brand}
        />
      }
    >
      {/* Hero */}
      <View style={styles.hero}>
        {business.coverImageUrl ? (
          <Image
            source={{ uri: business.coverImageUrl }}
            style={styles.heroCover}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.heroCoverPlaceholder, { backgroundColor: theme.bgAlt }]} />
        )}

        {/* Overlay with logo + name */}
        <View style={styles.heroOverlay}>
          {business.logoUrl && (
            <Image
              source={{ uri: business.logoUrl }}
              style={[styles.logo, { borderColor: theme.brand }]}
            />
          )}
          <Text style={[styles.businessName, { color: theme.textPri }]}>
            {business.name}
          </Text>
          {business.address && (
            <Text style={[styles.address, { color: theme.textSec }]}>
              {business.address}
            </Text>
          )}
        </View>
      </View>

      {/* About */}
      {business.about && (
        <View style={[styles.section, { backgroundColor: theme.bgAlt }]}>
          <Text style={[styles.about, { color: theme.textSec }]}>
            {business.about}
          </Text>
        </View>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <View style={styles.section}>
          {announcements.map((ann) => (
            <View
              key={ann.id}
              style={[styles.announcementCard, { backgroundColor: theme.card, borderColor: theme.brand + "44" }]}
            >
              {ann.isPinned && (
                <Text style={[styles.pinBadge, { color: theme.brand }]}>📌 מוצמד</Text>
              )}
              <Text style={[styles.annTitle, { color: theme.textPri }]}>{ann.title}</Text>
              <Text style={[styles.annContent, { color: theme.textSec }]}>{ann.content}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Quick Slots */}
      {quickSlots.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textPri }]}>⚡ תורים מהירים</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickScroll}>
            {quickSlots.map((slot, i) => (
              <TouchableOpacity
                key={`${slot.staffId}-${slot.date}-${slot.time}-${i}`}
                style={[styles.quickSlotCard, { backgroundColor: theme.card, borderColor: theme.brand + "55" }]}
                onPress={() => handleQuickSlot(slot)}
                activeOpacity={0.8}
              >
                <Text style={[styles.quickSlotDay, { color: theme.brand }]}>{slot.dayLabel}</Text>
                <Text style={[styles.quickSlotTime, { color: theme.textPri }]}>{slot.time}</Text>
                <Text style={[styles.quickSlotBarber, { color: theme.textSec }]}>{slot.staffName}</Text>
                <Text style={[styles.quickSlotService, { color: theme.textMuted }]}>{slot.serviceName}</Text>
                <Text style={[styles.quickSlotPrice, { color: theme.brand }]}>{formatPrice(slot.price)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Staff Grid */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.textPri }]}>הספרים שלנו</Text>
        {loading ? (
          <ActivityIndicator color={theme.brand} style={{ marginVertical: 20 }} />
        ) : (
          <View style={styles.staffGrid}>
            {staff.map((member) => (
              <StaffCard
                key={member.id}
                member={member}
                theme={theme}
                onPress={() => handleStaffPress(member)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Spacer for bottom CTA */}
      <View style={{ height: 100 }} />

      {/* Floating Book Button */}
      <View style={styles.ctaWrapper}>
        <TouchableOpacity
          style={[styles.ctaButton, { backgroundColor: theme.brand }]}
          onPress={handleBookNow}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>קבע תור ✂️</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 40 },

  hero: { position: "relative" },
  heroCover: { width: "100%", height: 220 },
  heroCoverPlaceholder: { width: "100%", height: 220 },
  heroOverlay: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    marginBottom: 10,
    backgroundColor: "#1A1A1A",
  },
  businessName: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
  },
  address: {
    fontSize: 14,
    textAlign: "center",
  },

  section: { paddingHorizontal: 16, paddingVertical: 14 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "right",
    marginBottom: 12,
  },

  about: { fontSize: 15, lineHeight: 22, textAlign: "right" },

  announcementCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  pinBadge: { fontSize: 12, fontWeight: "600", marginBottom: 4, textAlign: "right" },
  annTitle: { fontSize: 16, fontWeight: "700", textAlign: "right", marginBottom: 4 },
  annContent: { fontSize: 14, lineHeight: 20, textAlign: "right" },

  quickScroll: { marginHorizontal: -16, paddingHorizontal: 16 },
  quickSlotCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginLeft: 10,
    minWidth: 130,
    alignItems: "center",
  },
  quickSlotDay: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  quickSlotTime: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  quickSlotBarber: { fontSize: 13, marginBottom: 2 },
  quickSlotService: { fontSize: 12, marginBottom: 6 },
  quickSlotPrice: { fontSize: 15, fontWeight: "700" },

  staffGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },

  ctaWrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
  },
  ctaButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0A0A0A",
  },
});
