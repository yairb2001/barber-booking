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
| `/admin` | Calendar (the heart of the app — `src/app/admin/page.tsx`, ~3000 lines) |
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
- **`OtpCode`** — 6-digit codes, 10-min TTL, used by `/book/confirm` before creating appointment.
- **`Automation`** — `type` is `reengage` | `post_first_visit` | `post_every_visit`. JSON `settings` includes `delayMinutes` for post-visit kinds.
- **`SwapProposal`** — swap/move appointment proposals sent to customers via WhatsApp.

---

## Crons (`vercel.json`)

| Path | Schedule | What |
|---|---|---|
| `/api/cron/reminders` | `0 7 * * *` | 24h reminder before appointment |
| `/api/cron/reminders-2h` | hourly (configured separately?) | 2h reminder |
| `/api/cron/report-daily` | `0 19 * * 0-5` | End-of-day owner summary |
| `/api/cron/report-weekly` | `0 6 * * 0` | Weekly summary |
| `/api/cron/report-monthly` | `0 6 1 * *` | Monthly summary |
| `/api/cron/cleanup-conversations` | `0 4 * * *` | Delete chat threads older than 7 days |
| `/api/cron/automations-post-visit` | `*/15 * * * *` | Fires `post_first_visit` / `post_every_visit` honoring `delayMinutes` |
| `/api/cron/reengage` | `0 11 * * *` | "We miss you" message to inactive customers |

---

## Key flows / where the logic lives

- **Customer agent (AI)** — `src/lib/agent/customer-agent.ts`. Driven by Anthropic tool use. Tools live in `src/lib/agent/tools/` (book_appointment, list_services, etc.). Webhook entry: `src/app/api/webhook/whatsapp/route.ts`.
- **Outgoing messages** — always through `sendMessage()` in `src/lib/messaging/index.ts` (creates MessageLog, then provider.sendText). Provider is GreenAPI by default.
- **Phone normalization** — `normalizeIsraeliPhone()` in `src/lib/messaging/phone.ts` — converts to E.164 (`972...`). **Customer.phone may be stored in either `0...` or `972...` format** — always normalize before comparing.
- **Webhook** — saves *every* incoming message to `ConversationMessage` (regardless of agent on/off), then runs the agent only if enabled and not escalated. Captures `senderName` to `Conversation.whatsappName`.
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
- **`AUTH_SECRET`** is reused for the admin session JWT and the OTP token. Don't introduce a separate `JWT_SECRET`.
- **Never commit unless asked.** When asked, write a meaningful commit message and push to `main` (Vercel auto-deploys).

---

## Environment variables

```
DATABASE_URL          # Neon Postgres connection (pooled)
DIRECT_URL            # Neon direct connection (for migrations / db push)
AUTH_SECRET           # JWT signing — admin session + OTP token
ANTHROPIC_API_KEY     # AI agent
CRON_SECRET           # (optional) future use for cron auth
```

GreenAPI credentials are stored **per-business** in the DB (`Business.greenApiInstanceId`, `Business.greenApiToken`) — not in env.

---

## Files Claude should know about

```
src/app/admin/page.tsx                    # Calendar — biggest file in the project (~3k lines)
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
- **Vercel cron limits** — Hobby plan = daily only. Confirm Pro plan is active before adding sub-hour schedules.
- **Status field is no longer the source of truth for completion** — use `date + endTime` past + `status not in cancelled`.
