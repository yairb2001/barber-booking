import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";
import { generateSlug } from "@/lib/tenant";
import { notifyPlatformOwner } from "@/lib/super-admin";

/**
 * Self-service signup — creates a NEW business (tenant) and logs the owner in.
 *
 * Public endpoint (lives outside /api/admin, so the auth middleware doesn't
 * guard it). Owner identity is keyed to the Business itself (Business.passwordHash
 * + settings.ownerLoginPhone) — matching the login model in
 * src/app/api/admin/auth/login/route.ts.
 *
 * The person who opens the shop is ALSO created as a working barber: their own
 * Staff row (role "owner"), a full weekly calendar, and a starter service —
 * so the storefront is bookable the moment signup finishes, with nothing to
 * configure first. The owner still logs in at the BUSINESS level (no staffId in
 * the session → sees every calendar), so this staff row never scopes them down.
 *
 * New businesses start on the BASIC tier with a 14-day trial and no WhatsApp
 * connected (whatsappStatus = "not_requested"). They can take bookings
 * immediately; WhatsApp reminders stay muted until GreenAPI is provisioned.
 */

// Default weekly hours for the freshly-seeded owner-barber (Israeli barbershop
// baseline): Sun–Thu 09:00–20:00, Fri 09:00–14:00, Sat off. The owner tweaks
// these in the calendar afterwards — this just makes the shop bookable at once.
const FULL_DAY = JSON.stringify([{ start: "09:00", end: "20:00" }]);
const FRIDAY = JSON.stringify([{ start: "09:00", end: "14:00" }]);

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}
function phoneMatches(input: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const a = digits(input), b = digits(stored);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

const TRIAL_DAYS = 14;

export async function POST(req: NextRequest) {
  try {
    const { businessName, phone, password, confirmPassword } = await req.json();

    if (!businessName || typeof businessName !== "string" || businessName.trim().length < 2) {
      return NextResponse.json({ error: "נא להזין שם עסק" }, { status: 400 });
    }
    if (!phone || typeof phone !== "string" || digits(phone).length < 9) {
      return NextResponse.json({ error: "נא להזין מספר טלפון תקין" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "סיסמה חייבת להיות לפחות 6 תווים" }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "הסיסמאות לא תואמות" }, { status: 400 });
    }

    // Reject if this phone is already an OWNER login of an existing business —
    // owner login matches by phone, so two businesses sharing an owner phone
    // would be ambiguous. (A staff phone in another business is fine.)
    const owners = await prisma.business.findMany({
      where: { passwordHash: { not: null } },
      select: { phone: true, settings: true },
    });
    const phoneTaken = owners.some((b) => {
      let ownerLoginPhone: string | null = null;
      if (b.settings) {
        try {
          const s = JSON.parse(b.settings);
          if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
        } catch { /* ignore */ }
      }
      return phoneMatches(phone, b.phone) || phoneMatches(phone, ownerLoginPhone);
    });
    if (phoneTaken) {
      return NextResponse.json(
        { error: "מספר הטלפון כבר רשום במערכת. נסה להתחבר במקום זאת." },
        { status: 409 }
      );
    }

    const name = businessName.trim();
    const slug = await generateSlug(name);
    const passwordHash = await hashPassword(password);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const business = await prisma.business.create({
      data: {
        name,
        slug,
        phone,
        passwordHash,
        tier: "basic",
        trialEndsAt,
        whatsappStatus: "not_requested",
        settings: JSON.stringify({ ownerLoginPhone: phone }),
      },
      select: { id: true, slug: true },
    });

    // Seed the signer as a working barber so the shop is bookable immediately:
    // their own Staff row + a full weekly calendar + one starter service. We use
    // the business name as the barber name (no personal name is collected at
    // signup) — the owner renames it in the calendar. Best-effort: a failure
    // here must not block the account from being created.
    try {
      const ownerStaff = await prisma.staff.create({
        data: {
          businessId: business.id,
          name,
          phone,
          role: "owner",
          isAvailable: true,
          inQuickPool: true,
          isActive: true,
          canViewAllCalendars: true,
          canViewAllChats: true,
          sortOrder: 0,
        },
        select: { id: true },
      });

      await prisma.staffSchedule.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          staffId: ownerStaff.id,
          dayOfWeek,
          isWorking: dayOfWeek !== 6, // Saturday off
          slots: dayOfWeek === 5 ? FRIDAY : FULL_DAY,
          breaks: null,
        })),
      });

      const service = await prisma.service.create({
        data: {
          businessId: business.id,
          ownerStaffId: ownerStaff.id, // "their own" service
          name: "תספורת",
          price: 60,
          durationMinutes: 30,
          isVisible: true,
          sortOrder: 0,
        },
        select: { id: true },
      });

      await prisma.staffService.create({
        data: { staffId: ownerStaff.id, serviceId: service.id },
      });
    } catch (seedErr) {
      console.error("signup: owner-barber seed failed", seedErr);
    }

    await notifyPlatformOwner(`\u{1F389} \u05d4\u05e8\u05e9\u05de\u05d4 \u05d7\u05d3\u05e9\u05d4!\n\u05e2\u05e1\u05e7: ${name}\n\u05d8\u05dc\u05e4\u05d5\u05df: ${phone}`);

    const token = await signSession({ businessId: business.id, role: "owner" });
    const res = NextResponse.json({ ok: true, slug: business.slug });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("signup error", e);
    return NextResponse.json({ error: "שגיאה בהרשמה. נסה שוב." }, { status: 500 });
  }
}
