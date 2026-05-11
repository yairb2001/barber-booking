// ─── Shared TypeScript types for the mobile app ───────────────────────────

export type Business = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  address: string | null;
  about: string | null;
  brandColor: string;
  phone?: string | null;
  bookingHorizonDays?: number;
  socialLinks?: Record<string, string>;
  theme?: AppTheme;
  heroVideoUrl?: string | null;
};

export type AppTheme = {
  id: string;
  name: string;
  isDark: boolean;
  bg: string;
  bgAlt: string;
  card: string;
  brand: string;
  brandSoft: string;
  textPri: string;
  textSec: string;
  textMuted: string;
  divider: string;
};

export type StaffMember = {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  role: string;
  isAvailable: boolean;
  inQuickPool: boolean;
  bookingHorizonDays: number | null;
  minBookingLeadMinutes: number | null;
  portfolio: { id: string; imageUrl: string; caption: string | null }[];
};

export type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  showDuration: boolean;
  color: string | null;
  icon: string | null;
  note: string | null;
  sortOrder: number;
  customPrice?: number | null;
  customDuration?: number | null;
};

export type QuickSlot = {
  staffId: string;
  staffName: string;
  staffAvatar: string | null;
  date: string;      // YYYY-MM-DD
  dayLabel: string;  // "היום" / "מחר" / "יום שלישי"
  time: string;      // "HH:MM"
  timeMinutes: number;
  serviceId: string;
  serviceName: string;
  price: number;
  duration: number;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
};

export type Appointment = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  price: number;
  note: string | null;
  staff: { id: string; name: string; avatarUrl: string | null };
  service: { id: string; name: string; durationMinutes: number };
};

export type BookingSession = {
  businessId: string;
  businessSlug: string;
  staffId: string;
  staffName: string;
  staffAvatar: string | null;
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  serviceDuration: number;
  date: string;
  time: string;
};
