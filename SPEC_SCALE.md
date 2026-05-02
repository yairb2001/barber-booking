# אפיון — הפיכת DOMINANT למוצר SaaS המוני

מסמך אפיון מלא של כל מה שצריך לבנות/לשנות כדי לעבור ממערכת חד-לקוחית למוצר שאפשר למכור להמונים.

> **סימון `[החלטה]`** = נקודה שצריך להחליט עליה לפני/תוך כדי פיתוח. אל תתחיל לקודד את המודול עד שכל ה-`[החלטה]` שבו סגורות.

---

## 1. סקירה כללית

### מצב נוכחי
- אפליקציה רצה לעסק יחיד (DOMINANT)
- אין הרשמה לעסקים חדשים, אין תשלום, אין ניתוב
- כל הקוד כבר תומך ב-`businessId` ב-DB אבל לא בשכבת ה-routing/UI

### מצב יעד
- כל מספרה יכולה להירשם, לשלם, להגדיר את העסק שלה ולקבל subdomain ייחודי תוך 5 דקות
- 3 מסלולים (Basic / Pro / Premium) עם feature gating אוטומטי
- ממשק super-admin לניהול כל הלקוחות
- מערכת חיוב חודשית אוטומטית

---

## 2. שינויי ליבה (Core Changes)

### 2.1 Multi-tenant Routing
**מה קיים:** הכל hardcoded לעסק אחד, `findFirst()` ב-API.
**מה צריך:** ניתוב לפי `slug` של העסק.

**מודל ניתוב:**
- `app.dominant.co.il/[slug]` — דף ציבורי של מספרה (לדוגמה `app.dominant.co.il/dominant-tlv`)
- `[slug].dominant.co.il` — subdomain (אופציונלי, יותר יוקרתי)
- `app.dominant.co.il/admin` — ממשק ניהול של בעל העסק (מזוהה דרך JWT)
- `app.dominant.co.il/superadmin` — ממשק תפעול שלנו

**מה לבנות:**
- `middleware.ts` ב-Next.js שזורק את ה-`businessId` ל-context לפי URL
- כל ה-API routes יעברו לקבל `businessId` מה-context (לא יותר `findFirst`)
- כל queries ב-Prisma יקבלו `where: { businessId }`

`[החלטה]` — Path-based (`/[slug]`) או Subdomain-based (`[slug].domain.com`)? Path פשוט יותר טכנית, subdomain יוקרתי יותר. **המלצה:** להתחיל ב-path, לתת subdomain כתוספת בפרימיום.

`[החלטה]` — האם לתמוך ב-custom domain (המספרה מחברת `tor.barbershop.co.il`)? רק בפרימיום, בשלב מתקדם.

---

### 2.2 Authentication
**מה קיים:** `jose` ל-JWT, אין flow מסודר.
**מה צריך:** שני מסלולי הזדהות נפרדים.

**Business Owner Auth:**
- הרשמה עם אימייל + סיסמה (bcrypt)
- אימות אימייל בהרשמה
- שיכחת סיסמה
- JWT עם `businessId` + `role: "owner"|"staff"|"manager"`

**Customer Auth:**
- OTP בטלפון (כמו שכתוב באפיון המקורי)
- בלי סיסמה
- JWT עם `customerId` + `phoneNumber`

`[החלטה]` — ספק OTP לטלפון? **אפשרויות:** Twilio Verify (~₪0.30/אימות), 019 SMS, Vonage. **המלצה:** Vonage או 019 — זול יותר בישראל.

`[החלטה]` — אימות אימייל לבעלי עסק חובה או מומלץ? **המלצה:** חובה, מונע ספאם.

`[החלטה]` — Multi-user per business (מנהל + עובדים)? **המלצה:** לא ב-MVP, רק owner. להוסיף ב-V2.

---

### 2.3 Tier System & Feature Gating
**מה קיים:** אין.
**מה צריך:** מערכת מסלולים שמגבילה features אוטומטית.

**טבלה חדשה ב-DB: `Subscription`**
```
- businessId
- tier: "basic" | "pro" | "premium"
- status: "active" | "past_due" | "canceled" | "trialing"
- billingCycle: "monthly" | "yearly"
- currentPeriodEnd: DateTime
- stripeSubscriptionId / tranzilaToken
- trialEndsAt
```

**Feature flags לפי tier:**
| Feature | Basic | Pro | Premium |
|---------|-------|-----|---------|
| מספר ספרים | עד 3 | עד 10 | ללא הגבלה |
| מספר תורים/חודש | עד 200 | עד 1000 | ללא הגבלה |
| SMS אישורים | ✅ | ✅ | ✅ |
| WhatsApp הודעות | ❌ | ✅ (מספר משותף) | ✅ (מספר עצמי) |
| בוט AI | ❌ | ❌ | ✅ |
| Custom branding | ❌ | חלקי | מלא |
| Analytics | בסיסי | מתקדם | + AI insights |
| תמיכה | אימייל | אימייל + צ'אט | טלפון + WhatsApp |

**מה לבנות:**
- `lib/features.ts` — פונקציה `canUse(businessId, feature)` שבודקת tier
- Middleware ב-API routes שחוסם פעולות לפי tier
- UI components שמסתירות features שלא זמינות + מציעות upgrade

`[החלטה]` — מה קורה כשמסלול עובר את המכסה (לדוגמה 201 תורים בבייסיק)? **אפשרויות:** (א) חסימה מוחלטת (ב) להמשיך אבל להציג הודעת שדרוג (ג) לחייב automatically פר-תור נוסף. **המלצה:** (ב) — חוויה טובה יותר.

`[החלטה]` — Trial חינם? כמה ימים? **המלצה:** 14 ימים פרו בחינם, ואז ירידה לבייסיק או ביטול.

`[החלטה]` — האם הבסיק באמת חייב להיות זול-זול-זול (₪99) או שזה גבוה מדי לשוק הישראלי? צריך validation עם 5 מספרות.

---

### 2.4 Database Migrations
**מה צריך לשנות בסכימה:**

**טבלאות חדשות:**
- `Subscription` (ראה למעלה)
- `Usage` — מעקב חודשי לכל business: `appointmentsCount`, `smsSent`, `whatsappSent`, `aiTokensUsed`
- `Invoice` — חשבוניות שנוצרו
- `AuditLog` — מי עשה מה (לדיבוג + תמיכה)
- `WebhookEvent` — events מ-Stripe/Meta/Green

**שדות חדשים בטבלאות קיימות:**
- `Business`: `customDomain`, `timezone`, `locale`, `onboardingCompleted`, `whatsappProvider` (`none|meta|green`), `whatsappPhoneId`, `metaAccessToken` (encrypted), `greenApiInstanceId`
- כל הטבלאות עם `businessId`: וידוא שיש index על `businessId`

`[החלטה]` — encryption של tokens ב-DB? **המלצה:** כן, `node-forge` או Vercel-style env-based AES.

---

## 3. מודולים חדשים שצריך לבנות

### 3.1 Onboarding Flow
**מסך הרשמה ציבורי** (`/signup`):
1. שם + אימייל + סיסמה + טלפון
2. שם העסק + slug רצוי (וידוא ייחודיות) + סוג עסק (מספרה/קוסמטיקה/...)
3. בחירת מסלול → checkout → תשלום
4. דף הגדרה ראשונית (wizard):
   - לוגו + תמונת רקע
   - שעות עבודה
   - הוספת ספר ראשון
   - הוספת שירות ראשון
5. ✨ קישור לדף הציבורי שלהם

`[החלטה]` — onboarding ידני (wizard) או חופשי? **המלצה:** wizard עם אופציה לדלג.

`[החלטה]` — לאפשר signup בלי כרטיס אשראי (trial)? **המלצה:** כן, מגדיל המרה.

---

### 3.2 Billing (Stripe / Tranzila)
**מה לבנות:**
- אינטגרציה עם ספק תשלומים
- דף checkout בהרשמה
- דף billing בממשק האדמין (היסטוריה, שינוי כרטיס, החלפת מסלול, ביטול)
- Webhooks לעדכון סטטוס subscription
- חיובים אוטומטיים חודשיים
- שליחת חשבונית אוטומטית באימייל

`[החלטה]` **קריטית** — Stripe או ספק ישראלי (Tranzila / Cardcom / Greeninvoice)?
- **Stripe:** UX מעולה, עמלה 2.9%+30¢, אבל עובד עם USD/EUR — צריך המרה.
- **Tranzila/Cardcom:** עמלה 1.5–2%, ₪ ישיר, חשבונית מס ישראלית אוטומטית.
- **המלצה:** Tranzila או Cardcom + Greeninvoice — זה ישראלי, זול, חשבוניות מס.

`[החלטה]` — חודשי בלבד או גם שנתי בהנחה? **המלצה:** שנתי עם 2 חודשים מתנה — מגדיל retention.

`[החלטה]` — איך מטפלים בכשל תשלום? **המלצה:** dunning של 3 ניסיונות ב-7 ימים, ואז השעיה (לא מחיקה).

---

### 3.3 SMS Integration (לכל המסלולים)
**מה לבנות:**
- ספרייה `lib/sms.ts` עם `sendSms(businessId, phone, template, params)`
- Templates: אישור תור, תזכורת 24 שעות לפני, ביטול, שינוי
- Cron job שרץ כל שעה ובודק תורים שצריכים תזכורת
- מסך הגדרות לעסק: על/כיבוי תזכורות, מתי לשלוח, נוסח

`[החלטה]` — ספק SMS? **אפשרויות:** 019, InfoRU, Vonage, Twilio. **המלצה:** 019 או InfoRU — ישראלי, זול (~₪0.05/הודעה).

`[החלטה]` — מי משלם על ה-SMS? **אפשרויות:** (א) כלול במחיר עם מכסה (ב) חיוב נוסף לפי שימוש. **המלצה:** מכסה במחיר (200 ב-Basic, 1000 ב-Pro, ללא הגבלה ב-Premium).

---

### 3.4 WhatsApp — Meta Cloud API (Pro)
**מה לבנות:**
- Meta Embedded Signup flow — הלקוח מאשר שיתוף מספר ה-WhatsApp שלו
- שמירת `whatsappPhoneId` + `accessToken` (encrypted) ב-`Business`
- ספרייה `lib/whatsapp-meta.ts` עם `sendMessage(businessId, phone, template, params)`
- Webhook receiver לקבלת תשובות מהלקוח
- תבניות הודעה (templates) שאושרו ע"י Meta — חובה לכל הודעת outbound שנשלחת ראשונה

**אבל זכור:** המספר המשותף הוא של ה-SaaS, לא של המספרה.
`[החלטה]` — האם Pro באמת משתמש במספר משותף, או שכל עסק מקבל מספר משלו דרך Meta? **המלצה:** מספר משלו דרך Meta (Embedded Signup) — לקוח רואה שזה מהמספרה. עלות: בחינם עד 1000 שיחות/חודש.

`[החלטה]` — Templates בעברית — מי מאשר אותם מול Meta? **המלצה:** אנחנו מנסחים, מאשרים פעם אחת, וכל הלקוחות משתמשים באותם templates עם פרמטרים.

---

### 3.5 WhatsApp — Green API + AI (Premium)
**מה לבנות:**
- מסך onboarding לחיבור Green API: סריקת QR מהטלפון של המספרה
- ספרייה `lib/whatsapp-green.ts` עם API פרטי של Green
- בוט AI על Claude:
  - System prompt עם הקשר העסק (שעות, ספרים, שירותים, מחירים)
  - Function calling לפעולות (בדיקת זמינות, יצירת תור, ביטול, שאלות)
  - Conversation history per customer
  - Escalation לבעל העסק כשהבוט לא בטוח

**אופטימיזציות עלות AI:**
- Prompt caching של ה-system prompt (חוסך 90% בטוקנים חוזרים)
- ניתוב לפי מורכבות: Haiku לשאלות פשוטות, Sonnet/Opus למורכבות
- Context trimming — שמירת רק 10 הודעות אחרונות בהקשר

`[החלטה]` — באיזו רמת אוטונומיה הבוט פועל? **אפשרויות:** (א) רק עונה לשאלות, אדם מאשר תורים (ב) יוצר תורים אוטומטית, מודיע לבעל העסק (ג) פעולה מלאה. **המלצה:** להתחיל ב-(ב), לתת toggle לעבור ל-(ג) במספרות מנוסות.

`[החלטה]` — מה קורה כשהמכסה של AI מתמלאת? **המלצה:** הבוט ממשיך עם Haiku בלבד, מציע למספרה לשדרג מכסה.

`[החלטה]` — Green API נשאר לטווח ארוך, או נחפש חלופה זולה יותר? **המלצה:** בדיקה אחרי 6 חודשים — אם יש 50+ לקוחות פרימיום, שווה להעביר ל-WhatsApp Business API ישיר.

---

### 3.6 Super-admin Dashboard
**מה לבנות:**
- Login נפרד עם `role: "superadmin"`
- מסכים:
  - רשימת כל העסקים + סטטוס + tier + הכנסה חודשית
  - טבלת usage (מי בקרוב לחרוג ממכסה)
  - רשימת ביטולים + churn metrics
  - לוג שגיאות מערכת
  - גרפים: MRR, ARR, חדשים, churn, ARPU
  - יכולת להתחבר כעסק לצורך תמיכה (impersonation)
  - שליחת הודעות מערכת (broadcast לכל הלקוחות)

`[החלטה]` — איזה analytics tool? **אפשרויות:** PostHog, Mixpanel, Plausible, או DIY עם Recharts. **המלצה:** PostHog (חינם עד 1M events) + DIY של MRR.

---

### 3.7 Notifications System
**מה לבנות:**
- Queue מרכזי (`Notification` table) עם `type`, `channel` (sms/email/whatsapp), `status`, `scheduledFor`
- Cron job שמעבד את ה-queue כל דקה
- Retry logic עם backoff
- Templates ניתנים לעריכה במסך אדמין

`[החלטה]` — Queue פנימי או חיצוני (BullMQ + Redis)? **המלצה:** להתחיל פשוט עם Postgres + cron, לעבור ל-BullMQ אם מגיעים ל-1000+ הודעות/דקה.

---

### 3.8 Production Storage
**מה צריך:**
- Vercel Blob מוגדר (חסר כרגע — `BLOB_READ_WRITE_TOKEN` לא מוגדר ב-prod)
- מגבלות גודל לכל tier
- ניקוי תמונות יתומות (לא משויכות לכלום)

`[החלטה]` — לעבור ל-S3/R2 כדי להוזיל? **המלצה:** Vercel Blob עד 100 לקוחות, אחר כך לבחון Cloudflare R2 (זול פי 5).

---

### 3.9 Email Transactional
**מה לבנות:**
- ספרייה `lib/email.ts` עם templates (welcome, invoice, password reset, trial ending)
- ספק: Resend / SendGrid / Postmark

`[החלטה]` — ספק אימייל? **המלצה:** Resend — זול (3000 חינם/חודש), API נקי, deliverability טוב.

---

### 3.10 Analytics לבעל העסק
**מה לבנות:**
- מסך אנליטיקס בממשק האדמין:
  - תורים החודש vs חודש קודם
  - הכנסה משוערת
  - ספרים הכי עמוסים
  - שעות שיא
  - לקוחות חוזרים vs חדשים
  - מקור הגעה (מ"איך שמעת עלינו")
  - נטישת תור (no-show rate)

---

## 4. שינויים לקוד הקיים

### 4.1 כל ה-API routes
- כל route שעושה `prisma.X.findFirst()` בלי `where` → לעבור ל-`findUnique` עם `businessId` מה-context
- הוספת middleware של `withBusinessContext`
- הוספת middleware של `withTierCheck(feature)` ל-routes שמוגנים

### 4.2 Frontend
- הוספת `BusinessProvider` ב-Context API שמספק את ה-business הנוכחי לכל הקומפוננטות
- כל reference ל-"DOMINANT" בקוד → דינמי מה-business
- Branding (לוגו, צבעים, שם) דינמי בכל מקום

### 4.3 Image upload
- להגדיר Vercel Blob ב-prod (10 דקות עבודה)
- להוסיף מגבלות גודל לפי tier
- לדחוס תמונות לפני העלאה

---

## 5. תשתית & DevOps

### 5.1 Environments
- **Production** — Vercel (Next.js)
- **Staging** — Vercel preview deployment
- **Development** — local

### 5.2 Monitoring
- **Errors:** Sentry (חינם עד 5K errors/חודש)
- **Logs:** Vercel built-in + Axiom או Datadog
- **Uptime:** Better Uptime או UptimeRobot
- **Performance:** Vercel Analytics

`[החלטה]` — Sentry או alternative? **המלצה:** Sentry, סטנדרט תעשייתי.

### 5.3 Backups
- Neon כבר עושה point-in-time recovery (7 ימים בחינם, 30 בתשלום)
- לוודא שיש policy של 30 ימים ב-Pro של Neon

`[החלטה]` — כפילות backup ל-S3 חיצוני? **המלצה:** רק כשמגיעים ל-100+ לקוחות.

### 5.4 Security
- HTTPS אוטומטי (Vercel)
- Rate limiting על API routes (Vercel Edge Config / Upstash)
- CSRF protection
- SQL injection — Prisma מטפל
- XSS — React מטפל אוטומטית
- Audit log על פעולות רגישות

`[החלטה]` — האם צריך SOC2 / ISO27001? **המלצה:** לא ב-MVP, רק כשנגיע לעסקים גדולים.

---

## 6. Onboarding תוכן ושיווק

### 6.1 דף נחיתה (`dominant.co.il`)
- Hero — תורים אוטומטיים למספרה שלך
- Demo video של הפלואו
- מחירים
- Testimonials
- FAQ
- CTA → /signup

### 6.2 חומרי עזר ללקוחות
- Knowledge base (Notion/Helpcenter)
- וידאו onboarding
- WhatsApp תמיכה
- מדריך לאיך להעביר לקוחות מהמערכת הישנה

`[החלטה]` — מי בונה את אתר השיווק? **אפשרויות:** Webflow, אותו Next.js, Wordpress. **המלצה:** דף נחיתה ב-Next.js עצמו (פחות overhead).

---

## 7. סדר פיתוח מומלץ (12 חודשים)

### Sprint 1–2 (שבועיים): Foundation
- [ ] Multi-tenant routing + middleware
- [ ] רענון של כל ה-API routes ל-`businessId` מה-context
- [ ] Vercel Blob ב-prod
- [ ] Sentry

### Sprint 3–4: Auth + Onboarding
- [ ] Business owner auth (signup/login/email verification)
- [ ] Customer OTP auth
- [ ] Onboarding wizard
- [ ] Trial system

### Sprint 5–6: Billing
- [ ] בחירת ספק תשלומים + אינטגרציה
- [ ] Subscription management
- [ ] Webhook handlers
- [ ] חשבוניות

### Sprint 7–8: Tier System + SMS
- [ ] Subscription model + feature flags
- [ ] SMS integration + templates + cron
- [ ] Notifications queue

### Sprint 9–10: WhatsApp Pro (Meta)
- [ ] Meta Cloud API integration
- [ ] Embedded Signup flow
- [ ] Templates approval

### Sprint 11–12: WhatsApp Premium (Green + AI)
- [ ] Green API integration + QR onboarding
- [ ] AI agent (Claude + function calling)
- [ ] Cost optimizations (caching, routing)

### Sprint 13–14: Super-admin + Analytics
- [ ] Super-admin dashboard
- [ ] Business analytics
- [ ] PostHog integration

### Sprint 15+: Polish + Scale
- [ ] Custom domains (Premium)
- [ ] Multi-user per business
- [ ] Advanced analytics + AI insights
- [ ] בדיקות עומס

---

## 8. הערכת עלויות פיתוח

| שלב | זמן עבודה | עלות חיצונית (אם נעזרים) |
|-----|-----------|-------------------------|
| Foundation + Auth + Onboarding | 4 שבועות | ~₪15K |
| Billing | 2 שבועות | ~₪8K |
| Tier + SMS | 2 שבועות | ~₪7K |
| WhatsApp Meta | 2 שבועות | ~₪10K |
| WhatsApp Green + AI | 3 שבועות | ~₪15K |
| Super-admin + Analytics | 2 שבועות | ~₪7K |
| Polish | 2 שבועות | ~₪5K |
| **סה"כ** | **~17 שבועות** | **~₪67K** |

`[החלטה]` — לפתח לבד או לשכור? **המלצה:** Claude Code עוזר לעשות את זה לבד ב-3–4 חודשים full-time.

---

## 9. נקודות החלטה גדולות (לסקירה)

| # | החלטה | המלצה | סטטוס |
|---|-------|-------|-------|
| 1 | Path-based vs Subdomain routing | Path | פתוח |
| 2 | ספק תשלומים | Tranzila + Greeninvoice | פתוח |
| 3 | ספק SMS | 019 / InfoRU | פתוח |
| 4 | ספק OTP | Vonage / 019 | פתוח |
| 5 | Pro WhatsApp = משותף או עצמי? | עצמי דרך Meta | פתוח |
| 6 | רמת אוטונומיה של בוט AI | יוצר תורים + מודיע | פתוח |
| 7 | חודשי או שנתי? | שניהם | פתוח |
| 8 | Trial מצריך כרטיס? | לא | פתוח |
| 9 | Multi-user per business? | לא ב-MVP | פתוח |
| 10 | ספק email | Resend | פתוח |
| 11 | מדיניות מכסות | להמשיך עם הודעת שדרוג | פתוח |
| 12 | Custom domain ב-Premium? | כן, V2 | פתוח |

---

## 10. מה הצעד הראשון?

**הכי הגיוני להתחיל מ-Sprint 1–2 (Foundation).**
בלי multi-tenant routing אי אפשר לעשות שום דבר אחר.

תגיד לי מאיזה מודול להתחיל — אני אכתוב לכל מודול אפיון מפורט יותר (מסכים, API routes, DB schema, edge cases) לפני שמתחילים לקודד.
