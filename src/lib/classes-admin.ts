/** Validating what the classes screen sends (group classes, 16.10.2026). */
import { prisma } from "@/lib/prisma";

export type ClassBody = {
  name?: string; description?: string | null; durationMinutes?: number; capacity?: number; price?: number;
  staffId?: string | null; roomId?: string | null; cancelHours?: number;
  schedules?: { dayOfWeek: number; startTime: string; staffId?: string | null }[];
};

/** Validated fields of a class type (only the business's own staff and rooms). */
export async function classFields(businessId: string, b: ClassBody) {
  const staffOk = b.staffId ? !!(await prisma.staff.findFirst({ where: { id: b.staffId, businessId }, select: { id: true } })) : true;
  const roomOk = b.roomId ? !!(await prisma.room.findFirst({ where: { id: b.roomId, businessId }, select: { id: true } })) : true;
  return {
    ...(typeof b.name === "string" && b.name.trim() ? { name: b.name.trim().slice(0, 80) } : {}),
    ...(b.description !== undefined ? { description: b.description?.trim() || null } : {}),
    ...(Number.isInteger(b.durationMinutes) && b.durationMinutes! >= 5 && b.durationMinutes! <= 480 ? { durationMinutes: b.durationMinutes } : {}),
    ...(Number.isInteger(b.capacity) && b.capacity! >= 1 && b.capacity! <= 500 ? { capacity: b.capacity } : {}),
    ...(typeof b.price === "number" && b.price >= 0 ? { price: b.price } : {}),
    ...(b.staffId !== undefined && staffOk ? { staffId: b.staffId || null } : {}),
    ...(b.roomId !== undefined && roomOk ? { roomId: b.roomId || null } : {}),
    ...(Number.isInteger(b.cancelHours) && b.cancelHours! >= 0 && b.cancelHours! <= 168 ? { cancelHours: b.cancelHours } : {}),
  };
}

export async function scheduleRows(businessId: string, rows: ClassBody["schedules"]) {
  const out: { dayOfWeek: number; startTime: string; staffId: string | null }[] = [];
  for (const r of (rows ?? []).slice(0, 40)) {
    if (!Number.isInteger(r?.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6 || !/^\d{2}:\d{2}$/.test(r?.startTime ?? "")) continue;
    const staffOk = r.staffId ? !!(await prisma.staff.findFirst({ where: { id: r.staffId, businessId }, select: { id: true } })) : true;
    out.push({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, staffId: staffOk ? r.staffId || null : null });
  }
  return out;
}

