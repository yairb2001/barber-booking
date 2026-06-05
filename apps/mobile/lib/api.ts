// ─── API Client ───────────────────────────────────────────────────────────────
// Thin fetch wrapper that points at the Next.js backend.
// In dev: http://localhost:3001  |  In production: set via app.config.js

import Constants from "expo-constants";

const BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://192.168.1.102:3001";

type FetchOptions = RequestInit & { params?: Record<string, string | undefined | null> };

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(fetchOptions.headers ?? {}),
    },
    ...fetchOptions,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API calls ─────────────────────────────────────────────────────────

import type {
  Business,
  StaffMember,
  Service,
  QuickSlot,
  Announcement,
  Appointment,
} from "./types";

/** List all businesses (discovery screen) */
export const getBusinesses = () =>
  apiFetch<Business[]>("/api/businesses");

/** Get a single business by slug */
export const getBusiness = (slug: string) =>
  apiFetch<Business>("/api/business", { params: { slug } });

/** Get staff for a business */
export const getStaff = (businessId: string) =>
  apiFetch<StaffMember[]>("/api/staff", { params: { businessId } });

/** Get services (optionally scoped to a staff member) */
export const getServices = (businessId: string, staffId?: string) =>
  apiFetch<Service[]>("/api/services", { params: { businessId, staffId } });

/** Get available time slots */
export const getSlots = (businessId: string, staffId: string, serviceId: string, date: string) =>
  apiFetch<{ slots: string[]; closed?: boolean }>("/api/slots", {
    params: { businessId, staffId, serviceId, date },
  });

/** Get quick (next available) slots */
export const getQuickSlots = (businessId: string, staffId?: string) =>
  apiFetch<QuickSlot[]>("/api/quick-slots", { params: { businessId, staffId } });

/** Get announcements */
export const getAnnouncements = (businessId: string) =>
  apiFetch<Announcement[]>("/api/announcements", { params: { businessId } });

/** Send OTP to phone */
export const sendOtp = (phone: string, businessId: string) =>
  apiFetch<{ ok: boolean }>("/api/otp/send", {
    method: "POST",
    body: JSON.stringify({ phone, businessId }),
  });

/** Verify OTP and get JWT token */
export const verifyOtp = (phone: string, code: string, businessId: string) =>
  apiFetch<{ ok: boolean; token: string }>("/api/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code, businessId }),
  });

/** Create an appointment */
export const createAppointment = (
  data: {
    staffId: string;
    serviceId: string;
    date: string;
    startTime: string;
    customerName: string;
    customerPhone: string;
    referralSource?: string;
    otpToken: string;
    businessId?: string;
    price?: number;
    durationMinutes?: number;
  }
) =>
  apiFetch<Appointment>("/api/appointments", {
    method: "POST",
    body: JSON.stringify(data),
    headers: { Authorization: `Bearer ${data.otpToken}` },
  });

/** Get my appointments */
export const getMyAppointments = (phone: string, token: string, businessId?: string) =>
  apiFetch<{ upcoming: Appointment[]; past: Appointment[] }>("/api/my-appointments", {
    params: { phone, token, businessId },
  });

/** Join the waitlist */
export const joinWaitlist = (data: {
  phone: string;
  name: string;
  staffId?: string;
  serviceId: string;
  date: string;
  isFlexible?: boolean;
  preferredTimeOfDay?: string;
  businessId: string;
}) =>
  apiFetch("/api/waitlist", {
    method: "POST",
    body: JSON.stringify(data),
  });
