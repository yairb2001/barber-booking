# CLAUDE.md — DOMINANT Booking System

> **For Claude:** This file gives you fast context when starting a new session on this codebase. Read it first.

## What this is

SaaS booking system for barbershops (Hebrew, RTL). Multi-tenant from the schema level (every table has `businessId`). Currently runs DOMINANT barbershop in production, designed to onboard more shops. See `BUSINESS_CONTEXT.md` for product/pricing strategy.

**Live URL:** `https://barber-booking-indol.vercel.app` (Vercel auto-deploy on push to `main`)

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| DB | PostgreSQL on Neon, Prisma ORM |
| Storage | Vercel Blob (images) |
| Auth | JWT via `jose`, cookie `admin_session`, `bcryptjs` for passwords |
| WhatsApp | GreenAPI (`src/lib/messaging/green-api.ts`) |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) — customer agent in `src/lib/agent/` |
| Hosting | Vercel + Vercel Cron |

```bash
npm run dev        # next dev on port 3001
npm run build      # prisma generate && next build
npx prisma db push # apply schema changes (we don't use migrations)
npx tsc --noEmit   # type-check
```

---

## Roles & auth

Two roles encoded in JWT and headers (`x-session-business-id`, `x-session-role`, `x-session-staff-id`):

- **owner** — full access
- **barber** — scoped to their own data (own customers, own appointments, etc.)

Helpers in `src/lib/session.ts`:
- `getRequestSession(req)` — read JWT-injected headers
- `requireOwner(req)` — 403 for barbers
- `scopedStaffId(req)` — owner → `undefined` (sees all), barber → their `staffId`
- `requireOwnStaffOrOwner(req, resourceStaffId)` — barbers can only act on their own resources

---

## Key URLs

| Path | Notes |
|---|---|
| `/admin` | Calendar (the heart of the app — `src/app/admin/page.tsx`, ~6500 lines: grid, ApptModal card, NewApptModal, DayPanel, history modal) |
| `/admin/dashboard` | Owner stats + per-staff drill-down |
| `/admin/dashboard/marketing` | Referral source breakdown (2+/3+/10+ visit cohorts) |
| `/admin/dashboard/insights` | At-risk customers + peak hours heatmap |
| `/admin/chats` | Bidirectional WhatsApp inbox (toggle in business settings) |
| `/admin/agent` | AI agent config + conversation viewer (read-only) |
| `/admin/customers` | Customer list, can convert customer → staff |
| `/admin/messaging` | Broadcast WhatsApp to filtered customer groups |
| `/admin/staff/[id]` | Per-barber: services offered, schedule, booking horizon |
| `/admin/settings` | Business config (a long page — calendar hours, themes, automations, WhatsApp connection, chats toggle, etc.) |
| `/book/...` | Customer booking flow (with OTP verify before final submit) |

---

## Schema highlights

`prisma/schema.prisma` — all tables include `businessId`. Important models:

- **`Business`** — feature flags as columns: `chatsEnabled`, `reengageEnabled`. Free-form JSON `settings` for things like `calendarStartHour`, `calendarEndHour`, `appStoreUrl`, `themePreset`, `ownerLoginPhone`. Templates per kind (`reminder24hTemplate`, `confirmationTemplate`, etc.) — null means "use built-in default".
- **`Staff`** — `role` ("owner" | "barber"), `passwordHash`, per-staff `settings` JSON (overrides for `bookingHorizonDays`, `minBookingLeadMinutes`).
- **`StaffService`** — join table with `customPrice`, `customDuration` (per-barber service overrides).
- **`Appointment`** — `status` is `pending|confirmed|completed|cancelled_by_customer|cancelled_by_staff|no_show`. Manual "completed/no-show" buttons were removed from the UI; completion is now derived from `date + endTime` being in the past.
- **`Conversation` + `ConversationMessage`** — WhatsApp threads. `escalatedAt` = agent muted for 24h (lazy expiry on next incoming message). `lastReadAt` for unread badge. `whatsappName` captured from sender. `source` on messages: `agent` (AI) | `admin` (human reply).
- **`MessageLog`** — every outgoing WhatsApp goes here. `kind` is the channel (`confirmation`, `reminder_24h`, `agent_reply`, `manual`, `broadcast`, `post_first_visit`, `post_every_visit`, `otp`, etc.). Used for de-duplication of automations.
- **`OtpCode`** — 4-digit codes, 10-min TTL, `attempts` counter (5 → burn), used by `/book/confirm` before creating appointment. After verification the browser gets a 180-day sliding `bk_session` cookie; confirmations/reminders also carry a personal link (`?k=<customer_link JWT>`, `src/lib/customer-link.ts`) that signs the customer in without a code.
- **`Automation`** — `type` is `reengage` | `post_first_visit` | `post_every_visit`. JSON `settings` includes `delayMinutes` for post-visit kinds.
- **`Customer.notes`** — the permanent free-text note (searchable). `notificationPrefs` JSON still holds `noShowAck`.
- **`Appointment.confirmedAt`** — customer replied "1" to the reminder (only when `Business.settings.apptConfirmations` is on).
- **`Conversation.snoozedUntil`** — "remind me later" in the inbox.
- Derived customer facts (visits, rhythm, usual service/barber/day/hour, switched barber) come from `src/lib/customer-insights.ts` — used by the customer card, the appointment card, the agent context and recurring defaults.
- **`SwapProposal`** — swap/move appointment proposals sent to customers via WhatsApp.

---

## Crons (`vercel.json`)

| Path | Schedule | What |
|---|---|---|
| `/api/cron/reminders` | `0 1 * * *` | Daily scan — **enqueues** 24h (tomorrow) + 2h (today) reminders with precise `scheduledFor`. Does NOT send directly. |
| `/api/cron/drip-queue` | **external, every minute** | Drains scheduled MessageLog rows at ~1/min/business (anti-ban). Wire via cron-job.org → `?secret=<CRON_SECRET>`. Required for reminders/broadcast/waitlist to actually go out. |
| `/api/cron/reminders-2h` | external, every ~5 min (optional) | Sweep that catches **same-day** bookings made after the morning scan; enqueues missing 2h reminders. |
| `/api/cron/report-daily` | `0 19 * * 0-5` | End-of-day owner summary |
| `/api/cron/report-weekly` | `0 6 * * 0` | Weekly summary |
| `/api/cron/report-monthly` | `0 6 1 * *` | Monthly summary |
| `/api/cron/cleanup-conversations` | `0 4 * * *` | Delete chat threads older than 7 days |
| `/api/cron/automations-post-visit` | `*/15 * * * *` | Fires `post_first_visit` / `post_every_visit` honoring `delayMinutes` |
| `/api/cron/automations` | `0 11 * * *` | "We miss you" (reengage) message to inactive customers |
| `/api/cron/cleanup-conversations` | `0 4 * * *` | Delete chat threads idle for 90 days |

Piggybacked on the every-minute drip-queue tick: rolling reminder sweep (every 10 min, `src/lib/reminders-sweep.ts` — catches bookings made after the nightly scan), stuck-queue watchdog (owner push when work is due and nothing sends), agent question follow-up, link nudges. The drip queue observes **quiet hours 21:30–08:00** (Israel): nothing queued is delivered at night.

---

## Key flows / where the logic lives

- **Customer agent (AI)** — `src/lib/agent/customer-agent.ts`. Driven by Anthropic tool use. Tools live in `src/lib/agent/tools/` (book_appointment, list_services, etc.). Webhook entry: `src/app/api/webhook/whatsapp/route.ts`.
- **Outgoing messages** — always through `sendMessage()` in `src/lib/messaging/index.ts` (creates MessageLog, then provider.sendText). Provider is GreenAPI by default.
- **Phone normalization** — `normalizeIsraeliPhone()` in `src/lib/messaging/phone.ts` — converts to E.164 (`972...`). **Customer.phone may be stored in either `0...` or `972...` format** — always normalize before comparing.
- **Webhook** — saves *every* incoming message to `ConversationMessage` (regardless of agent on/off), then runs the agent only if enabled and not escalated. Captures `senderName` to `Conversation.whatsappName`. Before the agent, deterministic reply routers run: swap/move proposals, waitlist decline, and — when appointment confirmations are on — a bare "1"/"2" answer to the reminder (`src/lib/confirmations.ts`, pure code, no agent). In escalated threads a customer reply pushes the inbox handlers with the message text (`notifyOnReply`).
- **Customer-initiated changes** — cancel: `src/lib/appointments/cancel-by-customer.ts` (shared by the website, the "2" reply and the agent tool); move: `/api/my-appointments/move` (same barber/service, live availability, notice policy).
- **Waitlist on cancellation** — `Business.settings.waitlistMode`: `notify` (default, "a slot opened" message) or `auto` (first in line gets the slot, with a cancel link).
- **Agent sandbox** — `runCustomerAgent({ sandbox })`: no sends, mutating tools simulated; `POST /api/admin/agent/test` runs canned scenarios from the agent screen.
- **Build identity** — `src/lib/build-id.ts` (commit SHA via `NEXT_PUBLIC_BUILD_ID`); `/api/version` + the admin layout banner tell a stale native shell to reload.
- **Appointment completion** — no manual button. Cron `automations-post-visit` treats appointments as "done" when `endTime <= now - delayMinutes`, status not cancelled, no MessageLog with `(appointmentId, kind)` already.

---

## UI conventions

- **RTL Hebrew** — `dir="rtl"` on root, layout flips. Phone numbers always wrapped in `dir="ltr"` for correct rendering.
- **Tailwind** — `bg-teal-600` is the brand action color. `bg-emerald-*` for success. `bg-amber-*` for warnings/escalation. `bg-red-*` for destructive.
- **Mobile** — `useIsMobile()` hook in admin/page.tsx. Bottom nav in `admin/layout.tsx` switches based on `chatsEnabled` and `isOwner`.
- **Smart polling pattern** — `setInterval(fn, 10000)` + `document.visibilityState === "visible"` check + `visibilitychange` listener. Avoids polling when tab hidden. Used in `/admin/chats` and the unread badge.

---

## Working agreements

- **Always `npx prisma db push`** after schema changes. We don't use migrations.
- **Always `npx tsc --noEmit`** before committing. CI build is strict.
- **Hebrew + English on the same line is bad** — RTL/LTR mixing breaks. Put them on separate lines.
- **Don't add packages without asking** — the dep list is intentionally small (Next, Prisma, Anthropic, jose, bcrypt, Vercel Blob).
- **`AUTH_SECRET`** is reused for the admin session JWT, the OTP token, the customer session cookie and the customer link token — every verifier checks the `type` claim. Don't introduce a separate `JWT_SECRET`.
- **Cron auth is fail-closed** (`src/lib/cron-auth.ts`): every cron route returns 503 without `CRON_SECRET` and 401 on mismatch.
- **Public message-sending endpoints are rate-limited per IP** (`src/lib/rate-limit.ts`).
- **Never commit unless asked.** When asked, write a meaningful commit message and push to `main` (Vercel auto-deploys).

---

## Environment variables

```
DATABASE_URL          # Neon Postgres connection (pooled)
DIRECT_URL            # Neon direct connection (for migrations / db push)
AUTH_SECRET           # JWT signing — admin session + OTP token
ANTHROPIC_API_KEY     # AI agent
CRON_SECRET           # REQUIRED — every cron route fails closed without it
WHATSAPP_WEBHOOK_TOKEN # shared secret GreenAPI sends on the inbound webhook (set in Vercel + GreenAPI)
VAPID_PRIVATE_KEY     # web push (or per-business settings.vapidPrivateKey)
```

GreenAPI credentials are stored **per-business** in the DB (`Business.greenApiInstanceId`, `Business.greenApiToken`) — not in env.

---

## Files Claude should know about

```
src/app/admin/page.tsx                    # Calendar — biggest file in the project (~6.5k lines)
src/app/admin/layout.tsx                  # Sidebar + bottom nav, role-aware
src/app/admin/settings/page.tsx           # Long settings page — has tabs for general/whatsapp/automations
src/lib/session.ts                        # Auth/scoping helpers
src/lib/messaging/index.ts                # sendMessage, applyTemplate, default templates
src/lib/messaging/phone.ts                # normalizeIsraeliPhone (ALWAYS use for phone compare)
src/lib/messaging/green-api.ts            # GreenAPI provider implementation
src/lib/agent/customer-agent.ts           # AI agent runtime (tool use loop)
src/app/api/webhook/whatsapp/route.ts     # Inbound message handler (single critical file)
prisma/schema.prisma                      # Source of truth for the data model
vercel.json                               # Cron schedule
```

---

## Common pitfalls

- **Conversation-customer linking** — `Conversation.customerId` is only set when the agent identifies the customer via `book_appointment`. Cold conversations have no link. The chats API does a phone-based fallback lookup. If you need the name elsewhere, do the same — or use `Conversation.whatsappName` (always populated by the webhook).
- **Customer.phone format inconsistency** — see Schema highlights. Try multiple formats in `OR` clauses or use `normalizeIsraeliPhone()` on both sides.
- **Vercel cron limits** — Pro plan is active (sub-hour schedules in use: post-visit every 15 min).
- **Editing this repo from a Hebrew path** — the checkout under `Documents/קלוד` is iCloud-synced (NFC/NFD duplicate folders, stray `.git/* 2` files). Prefer a worktree outside iCloud (`git worktree add /private/tmp/... origin/main`).
- **Status field is no longer the source of truth for completion** — use `date + endTime` past + `status not in cancelled`.
