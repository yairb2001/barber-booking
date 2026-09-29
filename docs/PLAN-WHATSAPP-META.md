# תוכנית עבודה — וואטסאפ רשמי (Meta Cloud API) לצד Green API

> **למודל המבצע:** מסמך זה הוא מקור האמת לביצוע. הוא נכתב אחרי מיפוי מלא של הקוד (66 נקודות שליחה, תור ה-drip, ה-webhook, הצ'אטים, ההגדרות, מנהל-העל). כל הפניה ל-`file:line` אומתה מול הקוד בתאריך 12/09/2026. לפני כל שלב: קרא את `CLAUDE.md`. הסכמי עבודה: `npx prisma db push` (לא migrations), `npx tsc --noEmit` לפני commit, לא להוסיף חבילות בלי לשאול, לא לעשות commit בלי שביקשו. לענות ליאיר בעברית.

---

## 0. תקציר והחלטות שנסגרו

**המטרה:** לאפשר לכל עסק בפלטפורמה לרוץ על **Green API** (לא רשמי, מספר אישי ב-QR) **או** על **Meta Cloud API** (רשמי), עם בחירה פר-עסק — גם ע"י מנהל הפלטפורמה (super) וגם ע"י בעל העסק בהגדרות שלו. מעבר לרשמי משנה אוטומטית את כל מה שצריך: תבניות, חלון 24 שעות, מראה הצ'אטים, תור השליחה, אוטומציות, בריאות החיבור.

**החלטות מוצר (נסגרו עם יאיר, 12/09/2026):**

| # | נושא | החלטה |
|---|---|---|
| 1 | תבניות | **סט בסיס של הפלטפורמה** נשלח לאישור אוטומטית ברגע החיבור. עסק שרוצה לשנות — **בונה-תבניות בהגדרות** שלו, שמגיש לאישור מטא. |
| 2 | תפוצה | **היברידי לחיסכון:** לקוח בחלון פתוח מקבל טקסט חופשי (זול/חינם). לשאר — המערכת **מגישה תבנית בשקט מאחורי הקלעים** לנוסח של בעל העסק, ושולחת כשמאושר. **הקטגוריה נקבעת לפי התוכן** (לא תמיד שיווקי — utility זול פי ~6). |
| 3 | הסכמה | **מניחים הסכמה לכל מי שקבע תור.** רשת ביטחון: "הסר"/STOP אוטומטי, ניטור דירוג איכות, מגבלת נפח. |
| 4 | חיבור ותשלום | **"הלקוחות משלמים לי ואני משלם למטא — זה הדיל."** **לכל עסק מספר משלו**, רשום תחת ה-WABA של הפלטפורמה (מודל B, סעיף 2.3) — יאיר הוא הספק, הכרטיס שלו, הוא מחייב. **בעל העסק לא מתנהל מול מטא ולא צריך לדעת כלום — יש לו רק מסך הגדרות באפליקציה** (12.1). לסקייל: Solution Partner (C). Embedded Signup (A) רק ללקוח שמתעקש להחזיק את ה-WABA בעצמו. |
| 5 | תזכורת חכמה | (20/09) **מצב תזכורת "חכמה"** לבחירת העסק: תזכורת אחת עם כפתורי אשר/בטל ~16 ש' לפני (לא בלילה) → הלקוח עונה → החלון נפתח → כל ההמשך (2 ש', עיכוב, "תדרג") בתוך החלון. תזכורת 2 ש' רק למי שאישר (מתג: גם ללא-מאשרים, בתשלום). **תור לא מתבטל בלי אישור — מסומן.** הסוכן לא נוגע בכפתורים. סעיף 20.1. |
| 6 | ערוץ לפי סוג | (20/09) לכל סוג הודעה (אישור/ביטול/רשימת המתנה/אחרי ביקור) בחירה: וואטסאפ / **פוש-ואז-וואטסאפ** (ברירת מחדל — פוש חינם, וואטסאפ רק למי שאין לו) / כבוי. אישור מיידי כברירת מחדל דלוק, ניתן לכיבוי לחיסכון. סעיף 20.2-20.3. |
| 7 | מכסה וחבילות | (20/09) כל מסלול כולל **מכסת הודעות** (שיווקית = פי 6). מד שימוש + **הערכת מועד סיום**. 80% → התראה. במכסה מלאה: **תפעולי ממשיך כחריגה, שיווקי נעצר** עד חבילה/שדרוג. סעיף 20.4. |
| 8 | Green ללא שינוי | (20/09, חוזר ומודגש) **כל 5-7 חיים רק ב-`meta_cloud`.** ב-Green: אותה התנהגות בדיוק כמו היום, ההגדרות החדשות מוסתרות, הקרון המרווח נשאר. סעיף 20.0. |
| — | מספר משותף למסלול הזול | (20/09) **עתידי, לא בסקופ.** מתקן את החלטה 4 רק למסלול הזול ביותר: מספר פלטפורמה אחד לעסקים קטנים (תבניות כבר נושאות שם-עסק כמשתנה). מחיר: שם תצוגה של הפלטפורמה + דירוג איכות משותף. יאיר: "בהתחלה רק מסלולים מתקדמים, ואז נרד לזול". סעיף 20.6. |

**מודל התשלום (החלטת יאיר, 12/09):** **"הלקוחות משלמים לי, ואני משלם למטא — זה הדיל."** הפלטפורמה נושאת בעלות ההודעות ומגלמת אותה במחיר (חשבון אחד ללקוח, בלי הגדרת כרטיס במטא). לכן **מנופי החיסכון פר-הודעה הם כסף של הפלטפורמה** — לא רק ערך ללקוח. איך משיגים את זה מול מטא — סעיף 2.3 (בטא: WABA בבעלות הפלטפורמה; בהמשך: Solution Partner).

---

## 1. מודל העלות של מטא (ישראל, ספטמבר 2026)

מטא מתמחרת לפי **מדינת הלקוח** ולפי **קטגוריה**, פר-הודעה:

| קטגוריה | מה זה | עלות (₪, בקירוב) |
|---|---|---|
| `service` | תשובה חופשית בתוך חלון 24ש' שהלקוח פתח | חינם עד 30/9/2026 → **~0.02 מ-1/10/2026** |
| `utility` | תפעולי: אישור, תזכורת, שינוי, ביטול | ~0.02 (חינם בתוך חלון פתוח, עד 1/10) |
| `authentication` | קוד אימות (OTP) | ~0.02 |
| `marketing` | פרומו, תפוצה שיווקית, החזרת לקוחות | **~0.13** (פי 6.5) |
| חלון 72ש' מפרסומת Click-to-WhatsApp | | חינם (גם אחרי 1/10) |

**לתקצב לפי המצב שאחרי 1/10/2026.** למשוך תעריף ישראל חי מ-rate card של מטא לפני כל חישוב.

**מנופי החיסכון שהתכנון מממש:** (1) שיחה ביוזמת הלקוח → תשובות בחלון; (2) קטגוריה הכי זולה שחוקית לכל סוג הודעה; (3) utility בתוך חלון פתוח; (4) דילוג OTP ללקוח חוזר (`bk_session` 40 יום — כבר קיים); (5) איחוד הודעות; (6) תפוצה היברידית + סיווג קטגוריה; (7) Click-to-WhatsApp מהפיקסל/מודעות.

---

## 2. הצד של מטא — מה צריך, ומי משלם

### 2.1 צ'קליסט (עבודה של יאיר מול מטא, במקביל לקוד)

> **לבטא במודל B (סעיף 2.3) נדרשים רק פריטים 1, 2, 6, 7, 8** — בלי Tech Provider ובלי App Review. פריטים 3-5 נדרשים רק ל-Embedded Signup (A) ול-Solution Partner (C).

1. **Meta Business Portfolio** (Business Manager) + **אימות עסק** (Business Verification) — מסמכי עסק, אתר, טלפון. ללא אימות אין יכולת שליחה לצד שלישי.
2. **Meta App** מסוג Business ב-developers.facebook.com, עם מוצר **WhatsApp** מחובר ל-Portfolio.
3. **"Become a Tech Provider"** — בלוח הבקרה של האפליקציה (WhatsApp → Tech Provider onboarding). דורש 1+2.
4. **App Review** לגישה מתקדמת (Advanced Access) להרשאות: `whatsapp_business_management` (ניהול WABA + תבניות) ו-`whatsapp_business_messaging` (שליחה/קבלה). נדרש: כתובת מדיניות פרטיות (קיים: `דפי-נחיתה/privacy-policy.html` — לפרסם ב-URL ציבורי), תיאור שימוש עסקי, **וידאו/צילומי מסך של זרימת ה-Embedded Signup באפליקציה** (כלומר צריך לבנות את שלב 3 בקוד לפני/בזמן ההגשה).
5. **Embedded Signup Configuration** — ב-Facebook Login for Business ליצור קונפיגורציה ולקבל `config_id`.
6. **Webhook ברמת האפליקציה** — WhatsApp → Configuration: Callback URL = `https://<domain>/api/webhook/meta`, Verify Token, ולסמן שדות: `messages`, `message_template_status_update`, `account_update`, `phone_number_quality_update`.
7. **WABA של הפלטפורמה + אמצעי תשלום עליו** — משרת את DOMINANT ואת כל מספרות הבטא (מודל B). מספר DOMINANT ראשון, ואז מספרי הלקוחות מתווספים לאותו WABA (2.3). לניסוי: Meta נותנת מספר בדיקה חינמי ב-app dashboard.
8. **מפתחות לסביבה (Vercel):** `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION` (למשל `v21.0`), `META_SYSTEM_USER_TOKEN` (טוקן System User של הפורטפוליו — משמש את כל מספרי מודל B), `META_PLATFORM_WABA_ID`. ל-A בלבד: `META_CONFIG_ID`.

### 2.2 מה נותן כל מסלול
- **מודל B (בטא) — בלי Tech Provider:** מספיק Meta App + אימות עסק + System User token + WABA של הפלטפורמה. super מוסיף מספר של מספרה ב-3 קריאות API (2.3). הקוד זהה לכל המודלים.
- **Embedded Signup (מודל A):** בעל מספרה לוחץ "חבר וואטסאפ רשמי" → חלון פייסבוק → בוחר/יוצר WABA ומספר → האפליקציה מקבלת `code` + `phone_number_id` + `waba_id` אוטומטית. דורש Tech Provider + App Review.
- **טוקן עסקי** לכל לקוח (מוחלף מה-`code`), שמאפשר לנו לשלוח בשמו, לנהל תבניות ב-WABA שלו, ולהירשם ל-webhooks שלו.
- **Webhook אחד** לכל הלקוחות — ניתוב לפי `phone_number_id`.

### 2.3 מי הבעלים של המספר ומי משלם למטא — שלושה מודלים

| מודל | בעל ה-WABA | מי משלם למטא | מתאים ל- |
|---|---|---|---|
| **A. WABA של הלקוח** (Embedded Signup סטנדרטי, Tech Provider) | המספרה | **המספרה** (כרטיס משלה) — הפלטפורמה לא יכולה לשלם במקומה | לקוח שמתעקש להחזיק את המספר בעצמו |
| **B. WABA בבעלות הפלטפורמה** | הפורטפוליו של יאיר; מספרי הלקוחות נרשמים תחתיו | **יאיר** (כרטיס על ה-WABA שלו) → מחייב את הלקוחות | **הבטא (10 מספרות) — הדיל שיאיר רוצה** |
| **C. Solution Partner** (BSP) | הלקוח (OBO) | **יאיר** דרך קו אשראי ממטא → מחייב | סקייל; המסלול הרשמי ל-"הם משלמים לי ואני למטא" |

**הדרך שנבחרה:** **B לבטא** (מקבל את הדיל של יאיר מיד, בלי Embedded Signup, בלי כרטיס ללקוח), **הגשה ל-C במקביל** (Solution Partner דורש נפח/הסכמים — לוקח זמן), ו-**A כאופציה** ללקוח שרוצה מספר משלו.

**איך B עובד בפועל (super, ידני או API):**
1. ב-Business Portfolio של יאיר: WABA "Dominant Platform" (אפשר כמה WABA-ים; מגבלת מספרים ל-WABA ומגבלת WABA-ים לפורטפוליו גדלות עם אימות ונפח).
2. הוספת מספר של מספרה: `POST /{waba_id}/phone_numbers` `{ cc:"972", phone_number, verified_name:"<שם המספרה>" }` → `POST /{phone_number_id}/request_code` `{ code_method:"SMS", language:"he" }` → **הלקוח מקבל קוד ב-SMS ומזין אותו במסך ההגדרות שלו באפליקציה** (12.1) → `POST /{phone_number_id}/verify_code` → `POST /{phone_number_id}/register` עם pin. **הלקוח לא נוגע במטא בשום שלב.** המספר חייב להיות **לא** מחובר לוואטסאפ רגיל: מומלץ מספר ייעודי (SIM שני / מספר וירטואלי); או מיגרציה של המספר הקיים — ואז הוואטסאפ בטלפון שלו מפסיק לעבוד וכל השיחות עוברות לתיבה באפליקציה (זה המוצר — הסוכן עונה, הבעלים עונה מהתיבה).
3. שם תצוגה = שם המספרה (עובר ביקורת שם-תצוגה של מטא). **סיכון מדיניות לאמת במספר הראשון:** מטא דורשת ששם התצוגה ייצג את העסק; לפלטפורמה שמפעילה מספרים עבור לקוחות זה בד"כ מאושר.
4. כל המספרים חולקים פורטפוליו אחד → **דירוג איכות ונפח של לקוח אחד משפיעים על כולם.** לכן רשת הביטחון (סעיף 13) היא חובה, לא אופציה.
5. `metaWabaId` משותף (`META_PLATFORM_WABA_ID`), `metaPhoneNumberId` ייחודי לעסק, טוקן = System User של הפלטפורמה (`META_SYSTEM_USER_TOKEN`, אחד לכולם). הקוד לא משתנה — רק ההזנה.
6. **תבניות הן ברמת WABA** → סט הבסיס מוגש **פעם אחת** ומשרת את כל הלקוחות (9.2). חיסכון גדול בתפעול.

**השלכה על תמחור:** העלות פר-הודעה היא של הפלטפורמה → לתמחר מסלולים לפי נפח הודעות צפוי (למשל 490 כולל עד N הודעות/חודש, מעבר — לפי שימוש), ולעקוב בלשונית העלויות (12.2).

---

## 3. עקרונות ארכיטקטורה

1. **נקודת חנק אחת — `deliverMessageLog()`** (`src/lib/messaging/index.ts:315-364`). זו הפונקציה היחידה שקוראת לספק. היא מכירה `kind`, `businessId`, `customerPhone`, וה-`body` המרונדר. **כל לוגיקת "תבנית מול חופשי / חלון / קטגוריה" חיה שם** — וכך 60+ נקודות שליחה **לא נוגעים בהן**.
2. **ספק פר-עסק** — `providerForBusiness()` (`index.ts:46-62`) כבר מפעל; `Business.messagingProvider` כבר מוגדר `green_api | meta_cloud | none`. ממלאים את ה-stub `// future: meta_cloud` (שורה 60).
3. **Green נשאר כמו שהוא.** אפס שינוי התנהגות לעסק על Green. כל ההבדלים מותנים ב-`messagingProvider === "meta_cloud"`.
4. **תבנית = תוצר של `kind`.** רישום מרכזי `kind → { templateName, category, paramsOrder }`. הודעות מרונדרות ממשיכות להיווצר כמו היום; במטא, **מעבירים גם את המשתנים** (לא רק את הטקסט) כדי לשלוח כתבנית.
5. **חלון 24ש' = מצב של שיחה**, מחושב מ-`Conversation.lastInboundAt` (זול) ומוכרע סופית ע"י `windowExpiresAt` שמגיע מה-status webhook של מטא (סמכותי, כולל 72ש' של CTWA).
6. **עלות אמת** נכתבת ל-`MessageLog` מה-callback של מטא (`pricing.category`, `pricing.billable`) — לא הערכה.
7. **בטיחות:** אין 5xx ל-webhook; חתימה מאומתת; דה-דופ לפי `wamid`; לעולם לא לשלוח הודעה חופשית לחלון סגור (מטא מחזירה שגיאה 131047).

---

## 4. מודל הנתונים (שינויי `prisma/schema.prisma` → `npx prisma db push`)

```prisma
model Business {
  // ── Meta Cloud API (official) ──
  metaPhoneNumberId   String?   @unique @map("meta_phone_number_id")   // ניתוב webhook → עסק
  metaWabaId          String?   @map("meta_waba_id")
  metaAccessToken     String?   @map("meta_access_token")             // סוד. לא להחזיר ל-client (ראה 4.1)
  metaDisplayPhone    String?   @map("meta_display_phone")            // E.164 לתצוגה
  metaQualityRating   String?   @map("meta_quality_rating")           // GREEN | YELLOW | RED | UNKNOWN
  metaMessagingTier   String?   @map("meta_messaging_tier")           // TIER_250 | TIER_1K | ...
  metaTokenExpiresAt  DateTime? @map("meta_token_expires_at")
  metaConnectedAt     DateTime? @map("meta_connected_at")
  metaTemplatesSyncedAt DateTime? @map("meta_templates_synced_at")
}

model Conversation {
  lastInboundAt    DateTime? @map("last_inbound_at")     // מקור זול לחלון 24ש'
  windowExpiresAt  DateTime? @map("window_expires_at")   // סמכותי, מ-statuses[].conversation.expiration_timestamp
}

model ConversationMessage {
  providerMessageId String?  @unique @map("provider_message_id")  // wamid — דה-דופ אמיתי
  messageLogId      String?  @map("message_log_id")               // קישור לסטטוס מסירה (וי-וי בצ'אט)
}

model MessageLog {
  templateName    String?  @map("template_name")
  templateParams  Json?    @map("template_params")   // מערך מחרוזות לפי סדר {{1}}..{{n}} — נשמר בזמן enqueue
  category        String?                             // service | utility | marketing | authentication (מתוכנן/סופי)
  billable        Boolean? 
  costCategory    String?  @map("cost_category")      // מה שמטא דיווחה בפועל
  @@index([providerId])                                // status webhook lookup — הקיים לא מאונדקס
}

model Customer {
  marketingOptOut  Boolean  @default(false) @map("marketing_opt_out")   // "הסר"/STOP
  optOutAt         DateTime? @map("opt_out_at")
}

// חדש: רישום תבניות מטא פר-עסק
model WhatsAppTemplate {
  id           String   @id @default(uuid())
  businessId   String   @map("business_id")
  kind         String?                       // MessageKind שהתבנית משרתת (null = תבנית חופשית/תפוצה)
  metaName     String   @map("meta_name")    // שם ב-WABA (lowercase_underscore)
  language     String   @default("he")
  category     String                        // UTILITY | MARKETING | AUTHENTICATION
  bodyText     String   @map("body_text")    // הטקסט עם {{1}}..{{n}}
  paramsOrder  Json     @map("params_order") // ["name","business","date",...] — מיפוי שם→מיקום
  status       String   @default("pending")  // pending | approved | rejected | paused
  metaTemplateId String? @map("meta_template_id")
  rejectReason String?  @map("reject_reason")
  isPlatformBase Boolean @default(true) @map("is_platform_base")  // true = מסט הבסיס; false = של העסק
  createdAt    DateTime @default(now()) @map("created_at")
  approvedAt   DateTime? @map("approved_at")
  business     Business @relation(fields: [businessId], references: [id])
  @@unique([businessId, metaName])
  @@index([businessId, kind, status])
  @@map("whatsapp_templates")
}
```

**4.1 חובה — אבטחת סודות:** `GET /api/admin/business` (`src/app/api/admin/business/route.ts:6-19`) מחזיר את כל העמודות (מסיר רק `passwordHash`). להוסיף הסרה של `metaAccessToken` ו-`greenApiToken` מהתשובה (להחזיר `hasMetaToken: boolean` במקום). ה-`PATCH` (שורות 77-80) מקבל `messagingProvider` בלי ולידציה — להוסיף allow-list `["green_api","meta_cloud","none"]`.

---

## 5. שכבת הספק

### 5.1 הרחבת הממשק (`src/lib/messaging/types.ts`)

```ts
export type TemplateSend = {
  name: string;            // metaName
  language?: string;       // "he"
  params: string[];        // לפי סדר {{1}}..{{n}}
  category: "utility" | "marketing" | "authentication";
  // ל-authentication: params[0] = הקוד; הכפתור מקבל אותו קוד
};

export interface MessagingProvider {
  isConfigured(): boolean;
  /** free-form. במטא: מותר רק בחלון פתוח. */
  sendText(phone: string, body: string): Promise<SendResult>;
  /** תבנית מאושרת. Green: מרנדר לטקסט ושולח (fallback). */
  sendTemplate(phone: string, t: TemplateSend, renderedFallback: string): Promise<SendResult>;
  /** האם הספק דורש תבנית מחוץ לחלון */
  requiresTemplateOutsideWindow(): boolean;   // Green=false, Meta=true
  /** קצב שליחה */
  pacing(): { minGapMs: number; ratePerRun: number };  // Green {30000,1}, Meta {0,50}
}

export type ProviderConfig = {
  whatsappNumber?: string | null;
  greenApiInstanceId?: string | null;
  greenApiToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaAccessToken?: string | null;
  metaWabaId?: string | null;
};
```

`GreenApiProvider` מממש: `sendTemplate` = `sendText(phone, renderedFallback)`; `requiresTemplateOutsideWindow` = `false`; `pacing` = `{30_000, 1}`.

### 5.2 `MetaCloudProvider` — קובץ חדש `src/lib/messaging/meta-cloud.ts`

- בסיס: `https://graph.facebook.com/${META_GRAPH_VERSION}/`. Header: `Authorization: Bearer ${metaAccessToken}`. Timeout 12s (כמו Green).
- `sendText(phone, body)` → `POST /{phoneNumberId}/messages` `{ messaging_product:"whatsapp", to:<E.164 ספרות בלבד>, type:"text", text:{ body, preview_url:true } }`. תשובה: `messages[0].id` = `wamid` → `providerId`.
- `sendTemplate(phone, t)` → `type:"template"`, `template:{ name, language:{ code }, components:[{ type:"body", parameters: params.map(p=>({type:"text", text:p})) }] }`. ל-`authentication`: להוסיף `{ type:"button", sub_type:"url", index:"0", parameters:[{type:"text", text: code}] }`.
- מיפוי שגיאות מטא ל-`SendResult.error` קריא: `131047` → `window_closed`; `132000/132001` → `template_missing`; `131026` → `recipient_unavailable`; `130429` → `rate_limited`; `190` → `token_invalid`.
- טלפון: `normalizeIsraeliPhone()` (`src/lib/messaging/phone.ts`) ואז להסיר `+`. **לא** `toGreenChatId`.
- `getHealth()` → `GET /{phoneNumberId}?fields=quality_rating,verified_name,code_verification_status,messaging_limit_tier`.
- `createTemplate(waba, tpl)` → `POST /{wabaId}/message_templates` `{ name, language:"he", category:"UTILITY"|"MARKETING"|"AUTHENTICATION", components:[{ type:"BODY", text, example:{ body_text:[[...דוגמאות...]] } }] }` (+ לאימות: `components:[{type:"BODY", add_security_recommendation:true},{type:"FOOTER", code_expiration_minutes:10},{type:"BUTTONS", buttons:[{type:"OTP", otp_type:"COPY_CODE"}]}]`).
- `listTemplates(waba)` → `GET /{wabaId}/message_templates?fields=name,status,category,id`.
- `subscribeApp(waba)` → `POST /{wabaId}/subscribed_apps`. `registerPhone(pin)` → `POST /{phoneNumberId}/register` `{ messaging_product:"whatsapp", pin }`.

### 5.3 המפעל (`index.ts:46-62`)
```ts
if (kind === "meta_cloud") return new MetaCloudProvider({
  metaPhoneNumberId,
  metaAccessToken: metaAccessToken ?? process.env.META_SYSTEM_USER_TOKEN,   // מודל B: טוקן פלטפורמה משותף
  metaWabaId:      metaWabaId      ?? process.env.META_PLATFORM_WABA_ID,
});
```
ולהרחיב את `ProviderBusiness` (`index.ts:206-212`) ואת ה-`select` של תור ה-drip (`src/app/api/cron/drip-queue/route.ts:259-265`) בשדות מטא. **גם** את 4 המקומות שבונים `new GreenApiProvider` ישירות (ראה 11.3) — לעבור דרך המפעל או להתנות ב-provider.

---

## 6. מנוע ההחלטה בשליחה (`deliverMessageLog`, `index.ts:315-364`)

```
provider = providerForBusiness(business)
if (!provider?.isConfigured()) → failed:"provider_not_configured" (כמו היום)

if (!provider.requiresTemplateOutsideWindow()) {          // Green
  → כמו היום: split '---', sendText לכל חלק
}

// Meta:
reg = TEMPLATE_REGISTRY[log.kind]           // ראה 7
windowOpen = await isServiceWindowOpen(business.id, log.customerPhone)

if (reg.mode === "service_only") {          // agent_reply, manual, agent_followup...
  if (windowOpen) → sendText (split '---' מותר)
  else → failed:"window_closed" (+ ל-manual: ה-UI מונע מראש, ראה 12.3)
}
if (reg.mode === "template") {              // reminders, confirmation, otp...
  if (windowOpen && reg.category !== "authentication" && reg.preferFreeformInWindow) 
     → sendText(body)                        // חינם עד 1/10, אחר כך service ≈ utility → אפשר להשאיר תבנית
  else {
     tpl = await resolveApprovedTemplate(business.id, log.kind)   // WhatsAppTemplate approved
     if (!tpl) → failed:"template_not_approved" (+ התראה ל-super)
     params = log.templateParams ?? deriveParamsFromBody(log)     // legacy rows
     → sendTemplate(phone, { name: tpl.metaName, params, category })
  }
}
if (reg.mode === "hybrid_broadcast") {      // broadcast, agent_broadcast — ראה 9.4
  if (windowOpen) → sendText(body)
  else → (כבר יש templateName/params ברשומה מהזרימה ההיברידית) → sendTemplate
}
if (reg.mode === "skip_on_meta") → skipped:"not_applicable_meta"  // demo_*, qa_report
```

- **`---` split:** בתבנית — אין פיצול (תבנית אחת = הודעה אחת). ב-`sendText` — נשאר.
- **`templateParams`** נשמר ב-enqueue/send ע"י הקריאות שבונות משתנים ממילא (ראה 10.2). `deriveParamsFromBody` = fallback לרשומות ישנות: מנסה regex לפי התבנית; אם נכשל → `window_closed`/`template_not_approved` (מצב מעבר בלבד).
- `reconcileWaState()` (`index.ts:230-269`) — להשאיר ל-Green בלבד (כבר `instanceof GreenApiProvider`).
- אחרי שליחה בתבנית — לכתוב `templateName`, `category` (המתוכנן). `costCategory`/`billable` יגיעו מה-webhook.

---

## 7. רישום התבניות — `kind → תבנית → קטגוריה` (`src/lib/messaging/template-registry.ts`, חדש)

| Kind | Mode | קטגוריה | תבנית בסיס (metaName) | פרמטרים לפי סדר |
|---|---|---|---|---|
| `confirmation` | template | utility | `appt_confirmation` | name, business, date, time, staff, service, price, address_line |
| `first_booking` | template | utility | `appt_first_booking` | כנ"ל |
| `reminder_24h` / `_new` / `_returning` | template | utility | `appt_reminder_24h` (+`_new`, `_returning`) | name, business, date, time, staff, address_line |
| `reminder_2h` | template | utility | `appt_reminder_2h` | name, business, time, staff |
| `waitlist_notify` | template | utility | `waitlist_slot_open` | name, business, date, time, staff_line, booking_link |
| `appointment_moved` | template | utility | `appt_moved` | name, business, date, time, staff, service |
| `appointment_cancelled` (+self) | template | utility | `appt_cancelled` / `appt_self_cancelled` | name, business, date, time |
| `appointment_no_show` (+repeat) | template | utility | `appt_no_show` / `_repeat` | name, business, date, time |
| `delay_notification` | template | utility | `appt_delay` | name, business, time, delay_minutes |
| `swap_proposal` / `move_proposal` / `cancel_proposal` | template | utility | `appt_swap_proposal` / `appt_move_proposal` / `appt_cancel_proposal` | name, business, current_date, current_time, proposed_date, proposed_time, proposed_staff |
| `swap_confirmation` / `swap_cancelled` / `swap_followup` | template | utility | `appt_swap_confirmed` / `appt_swap_cancelled` / `appt_swap_followup` | name, business, date, time, staff, service |
| `swap_staff_request` / `agent_escalation` | template (לצוות) | utility | `staff_request` / `staff_alert` | staff_name, customer_name, details |
| `referral_thankyou` | template | utility | `referral_thanks` | name, business, friend_name |
| `walk_in` / `post_first_visit` | template | utility | `post_visit_thanks` | name, business, staff, booking_link |
| `post_every_visit` | template | **לפי תוכן** (CTA ביקורת = utility; פרומו = marketing) | `post_visit_cta` / `post_visit_promo` | name, business, staff, cta |
| `reengage` | template | marketing | `we_miss_you` | name, business, booking_link |
| `broadcast` / `agent_broadcast` | hybrid_broadcast | לפי סיווג | דינמי (9.4) | דינמי |
| `otp` | template | authentication | `login_code` | code |
| `report_daily/weekly/monthly`, `barber_daily_summary` | template (לבעלים) | utility | `owner_report` | period, headline_numbers, dashboard_link (קצר! מגבלת אורך פרמטר) |
| `agent_reply`, `manual`, `agent_followup`, `agent_question_followup`, `greeting_link`, `link_nudge` | service_only | service | — | — |
| `qa_report`, `demo_sales_pitch`, `demo_lead_captured` | skip_on_meta | — | — | — |

הערות: (א) `preferFreeformInWindow: true` ל-utility שנשלח כשהחלון פתוח (חינם עד 1/10; אחרי — service ≈ utility, אז אין הפסד). (ב) `agent_escalation`/`swap_staff_request` נשלחים **לאיש צוות** — לו יש חלון משלו; לרוב סגור → תבנית. (ג) הסוכן החכם (`customer-agent.ts:1542`) תמיד עונה בתוך חלון → service, אין שינוי.

**מיפוי משתנים:** הקוד שלנו משתמש ב-`{{name}}` (שמות, `applyTemplate` ב-`index.ts:91-96`). מטא דורשת `{{1}}..{{n}}` מיקומיים. `paramsOrder` בכל תבנית ממפה שם→מיקום. פונקציה `toMetaParams(vars, paramsOrder): string[]`. פרמטר ריק אסור במטא → להחליף ב-`"-"`.

---

## 8. חלון 24 השעות

- **כתיבה:** ב-webhook הנכנס (Meta ו-Green כאחד) — `Conversation.lastInboundAt = now`. ב-status webhook של מטא — `windowExpiresAt = conversation.expiration_timestamp` (ל-CTWA זה 72ש').
- **קריאה:** `isServiceWindowOpen(businessId, phone)` ב-`src/lib/messaging/window.ts` (חדש):
  `windowExpiresAt > now` → פתוח; אחרת `lastInboundAt > now-24h` → פתוח; אחרת סגור. Green → תמיד "פתוח" (לא רלוונטי).
- **חשיפה ל-UI:** `windowOpen`, `windowExpiresAt` ב-`GET /api/admin/chats` (`src/app/api/admin/chats/route.ts:121-133`) ובפרטי שיחה (`[id]/route.ts:66-82`).
- **חשוב:** ב-Green לא משתנה כלום. ה-`lastInboundAt` נכתב בכל מקרה (זול, שימושי).

---

## 9. תבניות — ניהול מלא

### 9.1 סט הבסיס של הפלטפורמה
קובץ `src/lib/messaging/base-templates.ts` עם ~25 תבניות (טבלה 7) בעברית, `{{1}}..{{n}}`, דוגמאות (`example.body_text`) — מטא דורשת דוגמה לכל פרמטר. הטקסטים נגזרים מ-`DEFAULT_*_TEMPLATE` הקיימים ב-`index.ts` (99-662) בהמרה למיקומיים. שם העסק **תמיד משתנה** (`{{business}}`) כדי שסט אחד ישרת את כולם.

### 9.2 סנכרון בחיבור (`src/lib/messaging/template-sync.ts`, חדש)
`ensureBaseTemplates(businessId)`: תבניות הן **ברמת WABA**. במודל B כל הלקוחות חולקים WABA → סט הבסיס מוגש **פעם אחת** ומשותף; `WhatsAppTemplate` נשמר עם `businessId` = הפלטפורמה (`SUPER_ADMIN_BUSINESS_ID`) ו-`resolveApprovedTemplate` נופל אליו כשאין תבנית של העסק. תבניות מותאמות של עסק (9.5) ותפוצות (9.4) מקבלות קידומת `b_<businessShortId>_` כדי לא להתנגש ב-WABA המשותף. במודל A (WABA של הלקוח) — לכל עסק סט משלו. לכל תבנית חסרה → `createTemplate` → `pending`. נקרא: (א) אחרי Embedded Signup / הזנה ידנית; (ב) כשבעל עסק עובר ל-`meta_cloud`; (ג) כפתור "סנכרן תבניות" ב-super. אידמפוטנטי. שגיאת "name exists" → `listTemplates` ולאמץ.

### 9.3 Webhook סטטוס תבנית
שדה `message_template_status_update` → `event: APPROVED|REJECTED|PAUSED|PENDING`, `message_template_name`, `reason` → לעדכן `WhatsAppTemplate.status`, `approvedAt`, `rejectReason`. על REJECTED של תבנית utility מסיווג אוטומטי (9.4) → **להגיש מחדש כ-marketing אוטומטית** (פעם אחת), ולעדכן את רשומת התפוצה.

### 9.4 תפוצה היברידית "בשקט מאחורי הקלעים" (`src/app/api/admin/messaging/broadcast/route.ts`)
זרימה חדשה כש-`messagingProvider === "meta_cloud"`:
1. בעל העסק כותב טקסט (עם `{{name}}` וכו') ובוחר קהל — **כמו היום**.
2. השרת: `classifyBroadcastCategory(text)` → `utility` אם אין רמזי פרומו (מילון: הנחה, מבצע, %, קופון, הטבה, מתנה, חינם, מחיר מיוחד, בלעדי) **ויש** רמזי מידע (סגור, פתוח, שעות, חג, עדכון, שינוי, תזכורת); אחרת `marketing`. בעל העסק רואה את הסיווג ויכול לדרוס ("זו הודעה שיווקית"). שמרני: בספק → marketing.
3. יוצרים `WhatsAppTemplate` (isPlatformBase=false, kind=null, metaName=`bc_<hash>`) ומגישים למטא. סטטוס התפוצה: **"ממתין לאישור מטא"** (בד"כ דקות; עד 24-48ש').
4. מפצלים את הקהל: **חלון פתוח** → `MessageLog` עם `scheduledFor=now`, `templateName=null` (יישלח חופשי, זול). **חלון סגור** → `MessageLog` עם `templateName`, `templateParams`, `scheduledFor=now`, אבל `status="awaiting_template"` (סטטוס חדש).
5. כשמגיע APPROVED → `updateMany status:"awaiting_template" → "scheduled"` → תור ה-drip שולח (בלי pacing, ראה 11). REJECTED → הגשה מחדש כ-marketing; אם גם זה נדחה → תפוצה "נכשלה" + הודעה לבעל העסק.
6. **מסננים `Customer.marketingOptOut`** לכל תפוצה בסיווג marketing. (utility/מידע תפעולי — לא מסננים.)
7. UI (`src/app/admin/messaging/page.tsx`): מצב "ממתין לאישור" עם מונה; "נשלח חופשי ל-X (חינם) / בתבנית ל-Y"; ETA מיידי במקום "~1 לדקה" (שורה 368).

`agent_broadcast` (סוכן הבעלים, `owner-agent.ts:645, 759`) — אותה זרימה דרך פונקציה משותפת `enqueueBroadcast(businessId, text, recipients)`.

### 9.5 בונה תבניות בהגדרות (בעל עסק)
`/admin/templates` (`src/app/admin/templates/page.tsx`) — כשהעסק על מטא:
- הטקסט של תבניות הבסיס מוצג **נעול** עם המשתנים, וכפתור "צור גרסה משלי".
- "גרסה משלי" = עורך עם המשתנים המותרים לאותו `kind` → הגשה למטא כ-`WhatsAppTemplate` (isPlatformBase=false, אותו kind) → סטטוס pending/approved/rejected מוצג.
- `resolveApprovedTemplate(businessId, kind)` מעדיף approved **של העסק** על פני הבסיס.
- על Green — הדף נשאר כמו היום (טקסט חופשי).

### 9.6 אוטומציות (`Automation.template`)
`reengage`/`post_first_visit`/`post_every_visit` — הטקסט המותאם עובר אותה זרימה כמו 9.5: בשמירת אוטומציה על עסק מטא → הגשה אוטומטית של תבנית (kind תואם) → הקרון שולח רק אם approved, אחרת מדלג עם לוג. ב-UI האוטומציות: תג סטטוס אישור.

---

## 10. Webhook של מטא

### 10.1 מסלול חדש — `src/app/api/webhook/meta/route.ts`
נפרד מ-Green (דרישות שונות: GET verify, גוף גולמי לחתימה, מבנה batched).
- **GET:** `hub.mode==="subscribe" && hub.verify_token===META_VERIFY_TOKEN` → להחזיר `hub.challenge` כ-`text/plain` 200. אחרת 403.
- **POST:** `raw = await req.text()`; לאמת `X-Hub-Signature-256` = `sha256=` HMAC(`META_APP_SECRET`, raw) עם `crypto.timingSafeEqual`; רק אז `JSON.parse`. **תמיד להחזיר 200** (גם על שגיאה פנימית) — מטא מנתקת מנוי אחרי כשלונות רצופים.
- **לולאה:** `entry[] → changes[] → value`. `value.metadata.phone_number_id` → `Business.metaPhoneNumberId` (בלי `fallbackBusiness`).
- **`value.messages[]`:** לכל הודעה — דה-דופ ב-`ConversationMessage.providerMessageId` (wamid); טקסט מ-`text.body` / `button.text` / `interactive.*.title`; מדיה → תווית עברית (מיפוי חדש ל-`image/video/audio/document/sticker/location/contacts`); שם מ-`contacts[0].profile.name`; `from` = E.164. → `handleInboundMessage({...})` (10.3). לעדכן `lastInboundAt`.
- **`value.statuses[]`:** `id` (wamid) → `MessageLog` לפי `providerId` (אינדקס חדש). `sent→sentAt`, `delivered→deliveredAt,status`, `read→readAt,status`, `failed→status failed, error=errors[0].title`. `pricing.category→costCategory`, `pricing.billable→billable`. `conversation.expiration_timestamp→Conversation.windowExpiresAt`.
- **`message_template_status_update`** → 9.3. **`phone_number_quality_update`** → `metaQualityRating`. **`account_update`** → לוג + התראה ל-super.

### 10.2 הודעת "הסר" (opt-out)
בתוך `handleInboundMessage`: אם הטקסט תואם `/^\s*(הסר|הסירו|stop|unsubscribe|בטל)\s*$/i` → `Customer.marketingOptOut=true` (לפי טלפון, שני הפורמטים) → תשובת service קבועה "הוסרת מרשימת התפוצה. הודעות על התורים שלך ימשיכו להגיע." (בחלון — חינם). לא מפעילים סוכן.

### 10.3 חילוץ הליבה המשותפת
לחלץ מ-`src/app/api/webhook/whatsapp/route.ts:157-550` פונקציה `handleInboundMessage({ businessId, phone, text, senderName, providerMessageId, isMedia })` ל-`src/lib/messaging/inbound.ts`. Green route קורא לה (בלי שינוי התנהגות), Meta route קורא לה. כולל: swap routers, owner-agent routing, link-first, escalation, agent.

### 10.4 מה נעלם במטא (לתעד ל-UI)
`outgoingMessageReceived` (בעלים הקליד מהטלפון → השתקת סוכן, `route.ts:169-205`) **לא קיים במטא** — המספר בבעלות ה-API. הצ'אט-אינבוקס הוא הדרך היחידה למענה אנושי. ההשתקה נשארת דרך התיבה (כבר קיים).

---

## 11. תור ה-drip — ביטול ה-"דקה אחר דקה" במטא

### 11.1 העיקרון
`scheduledFor` הוא **זמן סמנטי** (תזכורת 2ש' לפני) ונשמר. מה שמבטלים במטא הוא **הריווח** (30ש' בין הודעות, 1 לריצה, 60ש' stagger בתפוצה).

### 11.2 שינויים ב-`src/app/api/cron/drip-queue/route.ts`
1. לטעון `businesses` (עם שדות ספק) **לפני** השער (להעביר את ה-`findMany` משורה 256 לאחרי שורה 159).
2. `businessAllowed` (169-172): `if (pacingFor(biz).minGapMs === 0) return true`.
3. `RATE_PER_BUSINESS` (56, 180): לקרוא מ-`pacingFor(biz).ratePerRun` (Green 1, Meta 50).
4. לולאת המסירה (270-291): batches של 10 ב-`Promise.all`; להוסיף `export const maxDuration = 60`.
5. **Reaper** בראש ההנדלר: `status:"sending"` ו-`updatedAt < now-5min` → חזרה ל-`scheduled` (היום שורות תקועות לנצח).
6. השער סופר גם שליחות מיידיות (161): לסנן ל-`scheduledFor: { not: null }` כדי ש-OTP לא ידחה תזכורת (משפר גם Green).
7. סטטוס חדש `awaiting_template` (9.4) — לא נבחר ע"י `status:"scheduled"` עד האישור.
8. Night throttle (117-120): להשאיר (לא anti-ban; עלות DB). אופציונלי: דילוג כשקיים עסק מטא (cache 15 דק').

### 11.3 ריווח שנאפה ב-enqueue — לבטל במטא
- `broadcast/route.ts:164-169` — `BROADCAST_INTERVAL_SEC=60`+jitter → במטא `scheduledFor=now`. `etaMinutes` (191) → 0. `messaging/page.tsx:368` → טקסט תלוי ספק.
- `owner-agent.ts:631-645`, `:749-759` — אותו דבר (דרך `enqueueBroadcast`).
- `waitlist-notify.ts:119-124` — במטא אפשר מיידי גם ב-day-open.
- **לא לגעת:** `reminders/route.ts:114,161`, `reminders-2h/route.ts:85`, `waitlist-notify.ts:254` — זמנים סמנטיים.
- הקרונים החיצוניים (cron-job.org) ממשיכים — הם רק מפעילים את הניקוז.

---

## 12. ממשק המשתמש

### 12.1 הגדרות בעל העסק — `src/app/admin/settings/whatsapp/page.tsx`
- **באג לתקן קודם:** האופציה "Meta Cloud (רשמי — בקרוב)" (שורה 183) היא `value="none"`. להפוך ל-`value="meta_cloud"` ולהסיר `disabled` **רק** אם `hasMetaConnection` (יש `metaPhoneNumberId`+טוקן). אחרת להציג "חבר וואטסאפ רשמי" (12.4).
- **עיקרון: בעל העסק לא רואה את מטא בכלל.** אין פייסבוק, אין טוקנים, אין Business Manager, אין המילה "Meta" בממשק — רק "וואטסאפ רשמי". הכול במסך ההגדרות שלו: כרטיס "וואטסאפ רשמי" עם **אשף 3 שלבים** — (1) מזין את המספר הייעודי של המספרה (או מסמן "אין לי מספר פנוי" → פנייה לפלטפורמה), (2) מקבל SMS עם קוד **על אותו מספר** ומזין אותו כאן, (3) "מחובר ✓". מאחורי הקלעים: `POST /api/admin/meta/phone-numbers` (אותו endpoint של super ב-12.2, מוגן ב-`requireOwner` + עסק משלו בלבד). דגל `metaProvisioningRequiresApproval` (ברירת מחדל `true` בבטא) → הבקשה ממתינה לאישור super לפני `request_code`.
- בחירת ערוץ: כרטיס עם שני מצבים — "מספר אישי (QR)" / "וואטסאפ רשמי". מעבר לרשמי → `ensureBaseTemplates` (בפועל כבר מאושרות ברמת ה-WABA) + הודעה "מוכן". מעבר חזרה ל-QR → מיידי, Green creds נשמרים תמיד.
- כשעל רשמי: להסתיר QR/Instance/Token; להציג בשפה פשוטה: המספר, **תקינות המספר** (תקין / אזהרה / חסום ← `metaQualityRating`), **מכסת הודעות יומית** (← `metaMessagingTier`), **התבניות שלי** (X מאושרות / Y ממתינות ← `WhatsAppTemplate`), כפתור "רענן".
- הטקסט "מחובר/לא מוגדר" (170-172) — לפי הספק הפעיל.

### 12.2 מנהל הפלטפורמה — `/admin/super`
- בטבלת העסקים (`super/page.tsx`): עמודת "ערוץ" (Green/Meta/—) + פעולה "הגדר ערוץ".
- `PATCH /api/admin/super/businesses/[id]` (`route.ts`): להוסיף `messagingProvider`, `metaPhoneNumberId`, `metaWabaId`, `metaAccessToken`, `metaDisplayPhone`, `whatsappStatus:"connected"`, פעולה `syncTemplates`, `testMeta` (שולח תבנית בדיקה ל-SUPER_ADMIN_PHONE).
- **אשף "הוסף מספר לפלטפורמה" (מודל B) — `POST /api/admin/super/meta/phone-numbers`:** `{ businessId, phone, verifiedName }` → `POST /{META_PLATFORM_WABA_ID}/phone_numbers` → `request_code` (SMS) → super מזין את הקוד שהלקוח קיבל → `verify_code` → `register` (pin) → שמירה: `metaPhoneNumberId`, `metaWabaId=META_PLATFORM_WABA_ID`, `metaAccessToken=null` (משתמשים ב-`META_SYSTEM_USER_TOKEN`), `metaDisplayPhone`, `whatsappStatus="connected"`, `metaConnectedAt`. תבניות הבסיס כבר קיימות ב-WABA (הוגשו פעם אחת) — רק לוודא. אשף 3 שלבים ב-super: פרטים → קוד → סיום. **אותו endpoint משרת את האשף של בעל העסק (12.1)**; super רואה גם "בקשות חיבור ממתינות לאישור" ומאשר בלחיצה.
- רשימת "וואטסאפ תקוע" (`super/page.tsx:224`) — להרחיב ל-Meta: `metaQualityRating in (YELLOW,RED)` או `metaTokenExpiresAt < now+7d`.
- לשונית עלויות (`super/usage/route.ts`): להוסיף עלות מטא פר-עסק לפי `costCategory`+`billable` × תעריף (טבלת תעריפים ב-`src/lib/messaging/meta-rates.ts`, ניתנת לעדכון). זה מידע — הלקוח משלם למטא ישירות.

### 12.3 צ'אטים — `src/app/admin/chats/page.tsx` + API
- **תיקון סדר (קריטי):** `[id]/send/route.ts:35-42` כותב `ConversationMessage` **לפני** השליחה → במטא עם חלון סגור נראה כאילו נשלח. לשנות: שליחה → אם `ok` לכתוב את ההודעה + `messageLogId`; אם נכשל → להחזיר שגיאה ולא לכתוב (או לכתוב עם `status:"failed"` ולהציג ⚠️). אותו דבר ב-`send-quick/route.ts` ו-`open/route.ts`.
- **מחוון חלון:** בכותרת השיחה (318-343) צ'יפ "🟢 חלון פתוח · נסגר בעוד 3ש'" / "🔒 חלון סגור". ברשימה (216-266) אייקון 🔒 לשיחות סגורות. רק לעסק מטא.
- **חלון סגור → תבנית:** ה-textarea (392-420) נעול עם הסבר "עברו 24ש' מהודעת הלקוח — במטא ניתן לשלוח רק תבנית מאושרת". כפתור "שלח תבנית" → picker של `WhatsAppTemplate` approved עם kind בקבוצת "פנייה יזומה" (למשל `appt_reminder_24h`, `we_miss_you`, או תבנית חופשית של העסק) + מילוי משתנים (name אוטומטי) → `POST /api/admin/chats/[id]/send-template`.
- **וי-וי מסירה:** `ConversationMessage.messageLogId` → בפרטי שיחה להחזיר `deliveryStatus` (sent/delivered/read/failed) → ✓ / ✓✓ / ✓✓ כחול / ⚠️. (מחיה את ה-UI המת ב-`messaging/page.tsx:431-438`.)
- **הודעת שגיאה קריאה:** `window_closed` → "החלון נסגר — שלח תבנית"; `template_not_approved` → "התבנית עדיין ממתינה לאישור מטא".

### 12.4 חיבור Embedded Signup (מודל A בלבד — שלב 3, אופציונלי)
- קומפוננטה `MetaConnectButton`: טוען `https://connect.facebook.net/en_US/sdk.js` (script tag — לא npm), `FB.init({ appId: META_APP_ID, version })`, `FB.login(cb, { config_id: META_CONFIG_ID, response_type:"code", override_default_response_type:true, extras:{ setup:{}, featureType:"", sessionInfoVersion:"3" } })`. מאזין ל-`window.message` מ-`facebook.com` עם `type:"WA_EMBEDDED_SIGNUP"` → `data.phone_number_id`, `data.waba_id`.
- `POST /api/admin/meta/connect` `{ code, phoneNumberId, wabaId }` (owner או super עם `businessId`): החלפת `code` → טוקן (`GET /oauth/access_token?client_id&client_secret&code`), `subscribeApp(waba)`, `registerPhone(pin)` (pin 6 ספרות שנשמר), שמירה על ה-Business, `whatsappStatus="connected"`, `metaConnectedAt`, `ensureBaseTemplates`. **לא** משנה `messagingProvider` אוטומטית — בעל העסק בוחר (12.1); super יכול לכפות.
- טוקן: לאחסן מוצפן (AES-GCM עם `AUTH_SECRET` נגזר) או לפחות לא להחזיר ל-client. `metaTokenExpiresAt` מ-`debug_token` אם רלוונטי (טוקן System User לרוב ללא תפוגה).
- שלב בקליטה (`/admin/onboarding`, `PLAN-SAAS.md §E4`): "איזה וואטסאפ?" — Green (QR) / רשמי (Meta) / אחר כך.

### 12.5 עמוד תבניות ואוטומציות
כמתואר ב-9.5, 9.6. תגי סטטוס: ⏳ ממתין / ✅ מאושר / ❌ נדחה (+סיבה) / ⏸ מושהה.

### 12.6 באנר "וואטסאפ מנותק" (`AdminLayoutClient.tsx:323-336`, `WhatsAppReconnectModal`)
לעסק מטא: במקום QR — "הטוקן פג / דירוג המספר ירד ל-אדום — פתח הגדרות" עם קישור. `me/route.ts:48-88` (הבדיקה האופורטוניסטית) — לעסק מטא לבדוק `getHealth()` פעם ב-3 דק' (אותו throttle).

---

## 13. הסכמה, הסרה ורשת ביטחון

- **הנחת הסכמה** (החלטה 3): כל `Customer` נחשב מסכים. **חובה:** opt-out (10.2), סינון `marketingOptOut` בכל kind בסיווג marketing (broadcast marketing, `reengage`, `post_every_visit` פרומו), ותיעוד בדף פרטיות: "בקביעת תור אתה מסכים לקבל עדכונים; ניתן להשיב 'הסר'".
- **ניטור איכות:** `metaQualityRating` מה-webhook + health. YELLOW → התראה ל-super ולבעל העסק; RED → **להשהות אוטומטית** תפוצות marketing (לא utility) עד חזרה לירוק.
- **מגבלת נפח:** לפני תפוצה marketing — לבדוק `metaMessagingTier` (250/1K/10K/100K ל-24ש') ולחלק לגלים אם צריך; להציג לבעל העסק.
- **טקסט תבניות:** לכלול "להסרה השב 'הסר'" בתבניות marketing (משפר אישור + איכות).

---

## 14. בריאות וניטור (Meta)

- `src/app/api/cron/whatsapp-health/route.ts` (35-49 מסנן `green_api`): להוסיף ענף `meta_cloud` → `getHealth()` → לעדכן `metaQualityRating`, `metaMessagingTier`; `waLiveState` ניטרלי: `ok | warning | down` (במקום מחרוזות Green). שגיאת 190 → `down` + `metaTokenExpiresAt=now`.
- `me/route.ts` (10, 74, 89), `messaging/index.ts:216`, `super/page.tsx:224` — לנרמל את ההשוואות דרך helper `isWaDown(business)`.
- `admin/agent/test/route.ts:50-85` (דיאגנוסטיקה Green) — ענף מטא: תבניות מאושרות, טוקן תקין, webhook רשום (`GET /{waba}/subscribed_apps`).

---

## 15. מטריצת תרחישים

| # | תרחיש | Green (ללא שינוי) | Meta — התנהגות |
|---|---|---|---|
| 1 | לקוח כותב "רוצה תור" → הסוכן עונה | טקסט | service בחלון פתוח (חינם→0.02). ללא תבנית. |
| 2 | לקוח קובע ב-`/book` → אישור | טקסט | חלון כנראה סגור (לא כתב בוואטסאפ) → **תבנית utility** `appt_confirmation`. אם קבע דרך הסוכן → חלון פתוח → חופשי/utility חינם. |
| 3 | תזכורת 24ש' / 2ש' (drip) | 1/דקה | תבנית utility; נשלחת **בדיוק** ב-`scheduledFor`, בלי ריווח. |
| 4 | OTP בקביעת תור | טקסט | תבנית authentication עם כפתור העתקה. לקוח חוזר עם `bk_session` → אין OTP (חיסכון). |
| 5 | תפוצה ל-300 לקוחות | 300 דקות | 40 בחלון פתוח → חופשי מיד; 260 → תבנית (utility/marketing לפי סיווג) אחרי אישור, כולם תוך שניות. |
| 6 | ביטול תור → רשימת המתנה | טקסט מיידי | תבנית utility `waitlist_slot_open` מיידי. |
| 7 | הסוכן מציע החלפה ללקוח **אחר** (קר) | טקסט | `swap_proposal` = תבנית utility. תשובת "כן/לא" של הלקוח פותחת חלון → המשך חופשי. |
| 8 | follow-up של הסוכן אחרי 20ש' שקט | טקסט | חלון עדיין פתוח (24ש') → service. אחרי 24ש' → **מדולג** (AI לא יכול להיות תבנית). |
| 9 | בעלים עונה מהתיבה אחרי 30ש' | טקסט | חלון סגור → תיבה נעולה → בוחר תבנית → utility. |
| 10 | בעלים מקליד מהטלפון | משתיק סוכן | **לא מגיע** (המספר בבעלות ה-API). מענה אנושי רק מהתיבה. |
| 11 | דוח יומי לבעלים | טקסט ארוך | תבנית utility קצרה `owner_report` + קישור לדשבורד. |
| 12 | "החזרת לקוח" (reengage) | טקסט | תבנית marketing `we_miss_you`; מסנן opt-out; מושהה ב-RED. |
| 13 | לקוח כותב "הסר" | — | opt-out + תשובת אישור (service). |
| 14 | מעבר Green→Meta עם 40 תזכורות מתוזמנות | — | לרשומות יש `templateParams` (10.2/6) → נשלחות כתבנית. רשומות ישנות בלי params → `deriveParamsFromBody`, ואם נכשל → failed עם התראה (מצב מעבר). |
| 15 | מעבר Meta→Green | — | מיידי; הכול חוזר לטקסט; תבניות ב-WABA נשארות. |
| 16 | תבנית עדיין pending בזמן שליחה | — | `template_not_approved` → נשאר `scheduled` ונבדק שוב בריצה הבאה (לא failed) עד 48ש', ואז failed + התראה. |
| 17 | הטוקן של מטא פג | — | 190 → `down`, באנר "חבר מחדש", תור נעצר לעסק (לא נכשל), חוזר כשמתחבר. |
| 18 | לקוח הגיע מפרסומת Click-to-WhatsApp | — | `windowExpiresAt` = 72ש' (מה-status) → הכול חופשי וחינם 3 ימים. |
| 19 | הדגמה ב-`/for-business` (DEMO_BUSINESS) | failed by design | `skip_on_meta` — לא משתנה. |
| 20 | `request-whatsapp` (בקשת חיבור) | שולח מעסק אחר | לתקן: לשלוח מהעסק של הפלטפורמה (`SUPER_ADMIN_BUSINESS_ID`) דרך `notifyPlatformOwner`. |

---

## 16. תוכנית ביצוע — שלבים, משימות, קריטריוני קבלה

### שלב 0 — צד מטא (יאיר, במקביל, ללא קוד)
לבטא (מודל B): סעיף 2.1 פריטים 1, 2, 6, 7, 8 + System User token. **פותחים היום** — אימות עסק לוקח ימים. App Review (פריטים 3-5) רק אם רוצים Embedded Signup / Solution Partner — אפשר לפתוח במקביל, לא חוסם.

### שלב 1 — יסודות: שליחה וקבלה רשמית + עלות אמת (הליבה)
| # | משימה | קבצים | קבלה |
|---|---|---|---|
| 1.1 | Schema (סעיף 4) + `db push` | `prisma/schema.prisma` | `tsc` נקי; עמודות קיימות |
| 1.2 | אבטחת סודות + ולידציה (4.1) | `api/admin/business/route.ts` | `GET` לא מחזיר טוקנים; `PATCH` דוחה ספק לא חוקי |
| 1.3 | ממשק ספק + `pacing`/`requiresTemplateOutsideWindow` ל-Green (5.1) | `messaging/types.ts`, `green-api.ts` | Green מתנהג זהה |
| 1.4 | `MetaCloudProvider` (5.2) + מפעל (5.3) + `ProviderBusiness`/select | `meta-cloud.ts` (חדש), `index.ts`, `drip-queue/route.ts` | שליחת טקסט/תבנית ידנית לעסק בדיקה |
| 1.5 | רישום תבניות + base-templates + `toMetaParams` (7, 9.1) | `template-registry.ts`, `base-templates.ts` (חדשים) | יחידה: כל kind ממופה; 0 kinds ללא mode |
| 1.6 | `window.ts` + כתיבת `lastInboundAt` בשני ה-webhooks (8) | `messaging/window.ts`, `webhook/whatsapp/route.ts` | Green: `lastInboundAt` מתעדכן, אפס שינוי אחר |
| 1.7 | מנוע ההחלטה ב-`deliverMessageLog` (6) | `index.ts:315-364` | Green זהה; Meta: service בחלון / תבנית מחוץ / failed ברור |
| 1.8 | `templateParams` ב-enqueue: תזכורות, waitlist, אישורים (10.2) | `cron/reminders`, `reminders-2h`, `waitlist-notify.ts`, `appointments/route.ts`, `admin/appointments/*` | רשומות חדשות נושאות params |
| 1.9 | חילוץ `handleInboundMessage` (10.3) — Green קורא לה | `lib/messaging/inbound.ts`, `webhook/whatsapp/route.ts` | Green webhook: התנהגות זהה (בדיקת רגרסיה על שיחה אמיתית) |
| 1.10 | Webhook מטא: GET verify, חתימה, messages, statuses, template status, quality, opt-out (10.1-10.2) | `api/webhook/meta/route.ts` (חדש) | הודעה נכנסת → תשובת סוכן; status → `deliveredAt`/`costCategory` נכתבים |
| 1.11 | `template-sync.ts` + `ensureBaseTemplates` (9.2) | חדש | 25 תבניות pending ב-WABA של DOMINANT; אישור מגיע ב-webhook |
| 1.12 | drip: pacing פר-ספק, reaper, batches, `awaiting_template`, סינון שער (11.2) | `drip-queue/route.ts` | Meta: 50 לריצה, 0 ריווח; Green: 30ש'/1; אין רשומות `sending` תקועות |
| 1.13 | ביטול stagger בתפוצה/owner-agent/waitlist במטא (11.3) | `broadcast/route.ts`, `owner-agent.ts`, `waitlist-notify.ts` | תפוצה במטא: `scheduledFor=now` |
| 1.14 | super: ערוץ פר-עסק + **אשף הוספת מספר לפלטפורמה** (מודל B) + הזנה ידנית + סנכרון + בדיקה (12.2) | `super/page.tsx`, `super/businesses/[id]/route.ts`, `super/meta/phone-numbers/route.ts` (חדש) | super מוסיף את מספר DOMINANT ל-WABA של הפלטפורמה ומעביר ל-meta |
| 1.15 | הגדרות בעל עסק: תיקון `value="none"`, בחירת ספק, מצב מטא (12.1) | `settings/whatsapp/page.tsx` | מעבר Green↔Meta עובד; טוקנים לא נחשפים |
| 1.16 | health לעסק מטא + `isWaDown` (14) | `cron/whatsapp-health`, `me/route.ts`, `index.ts` | `metaQualityRating` מתעדכן; באנר נכון |

**קבלה לשלב 1 (על DOMINANT במטא):** (א) לקוח כותב → הסוכן עונה (service); (ב) קביעה ב-`/book` → אישור כתבנית utility, `costCategory=utility` נרשם מה-webhook; (ג) תזכורת 24ש' נשלחת בזמן, כתבנית, בלי ריווח; (ד) OTP כתבנית authentication; (ה) statuses מעדכנים delivered/read; (ו) מעבר חזרה ל-Green ושליחה תקינה; (ז) עסק אחר על Green — אפס שינוי; (ח) `tsc` נקי.

### שלב 2 — ממשק, היברידי, בטיחות
| # | משימה | סעיף |
|---|---|---|
| 2.1 | צ'אטים: תיקון סדר כתיבה, מחוון חלון, נעילה + picker תבנית, `send-template`, וי-וי | 12.3 |
| 2.2 | תפוצה היברידית + סיווג + "ממתין לאישור" + פיצול קהל + resubmit אוטומטי | 9.4, 9.3 |
| 2.3 | עמוד תבניות: נעול/גרסה משלי/סטטוס; `resolveApprovedTemplate` מעדיף של העסק | 9.5 |
| 2.4 | אוטומציות מגובות-תבנית + תגי סטטוס | 9.6 |
| 2.5 | opt-out מלא + סינון marketing + השהיה ב-RED + נפח לפי tier | 13 |
| 2.6 | דוחות לבעלים כתבנית קצרה; owner-agent: להחליף "DOMINANT" בשם העסק (`owner-agent.ts:356,461`), אישורים דרך `confirmationTemplate` | 7, 15 |
| 2.7 | `request-whatsapp` דרך העסק של הפלטפורמה | 15 #20 |
| 2.8 | לשונית עלויות ב-super עם `meta-rates.ts` | 12.2 |

**קבלה:** תפוצה של 20 לקוחות במטא: X חופשי, Y בתבנית אחרי אישור; "הסר" עובד; תיבה נעולה אחרי 24ש' ושליחת תבנית מצליחה; וי-וי מוצגים.

### שלב 3 — Embedded Signup (מודל A — אופציונלי, אחרי App Review) + הגשה ל-Solution Partner (C)
| # | משימה | סעיף |
|---|---|---|
| 3.1 | `MetaConnectButton` + `POST /api/admin/meta/connect` + הצפנת טוקן | 12.4 |
| 3.2 | שלב "איזה וואטסאפ?" בקליטה | 12.4 |
| 3.3 | וידאו הזרימה ל-App Review (יאיר) | 2.1 #4 |
| 3.4 | הגשה ל-Solution Partner (יאיר) — עם נפח הבטא; מעבר מודל B→C כשמאושר (קו אשראי במקום כרטיס) | 2.3 |

**קבלה:** עסק חדש מתחבר בלחיצה; תבניות בסיס מוגשות אוטומטית; הודעה ראשונה יוצאת תוך דקות מהחיבור.

### שלב 4 (עתידי, לא בסקופ)
Solution Partner (קו אשראי + מרווח); הודעות אינטראקטיביות (כפתורים/רשימות) בסוכן. **לא בתוכנית:** מספר פלטפורמה משותף (`tier.ts` `sharedWhatsapp`) — יאיר החליט שלכל עסק יהיה מספר משלו.

---

## 17. אימות (לכל שלב)
- `npx tsc --noEmit` נקי; `npm run build` ירוק.
- **רגרסיית Green:** לפני/אחרי — שיחה אמיתית עם הסוכן, תזכורת מתוזמנת, תפוצה קטנה. חייב להיות זהה.
- **מטא:** עם מספר הבדיקה של מטא ואז DOMINANT. לבדוק כל שורה במטריצה (15) הרלוונטית לשלב. Events Manager/Webhooks log במטא.
- **ניקוי:** למחוק כל הודעות/רשומות בדיקה בפרודקשן (MessageLog, ConversationMessage, WhatsAppTemplate `bc_test_*`) — לספור 0.
- **עלות:** אחרי יום — `SELECT costCategory, COUNT(*), SUM(billable::int)` פר-עסק תואם ל-Meta billing.

## 18. סיכונים ומענה
| סיכון | מענה |
|---|---|
| App Review מתעכב | שלב 1-2 עובדים בהזנה ידנית (super) עם טוקן System User מה-Business של יאיר — DOMINANT רץ רשמית בלי לחכות |
| תבנית utility נדחית כ-promotional | resubmit אוטומטי כ-marketing (9.3); סיווג שמרני |
| דירוג איכות יורד (הנחת הסכמה) | opt-out, השהיה ב-RED, נפח לפי tier, "הסר" בטקסט |
| רשומות מתוזמנות ישנות בלי params | `deriveParamsFromBody` + התראה; לפרוס את 1.8 **לפני** מעבר עסק ראשון |
| פרמטר ארוך (דוחות) | תבנית קצרה + קישור |
| `---` בתבנית | אין פיצול בתבנית; base-templates ללא `---` |
| טוקן דולף מ-`GET /api/admin/business` | 1.2 חובה לפני 1.14 |
| 1/10/2026: service מתחיל לעלות | כבר מתוקצב; `preferFreeformInWindow` נשאר נכון (service≈utility) |
| פורטפוליו משותף (מודל B): לקוח אחד ספאם → דירוג/מגבלות של כולם | השהיה אוטומטית ב-YELLOW/RED לעסק החורג, נפח לפי tier, אישור super לתפוצות marketing גדולות, אפשרות להעביר לקוח בעייתי ל-WABA נפרד |
| שם תצוגה של מספרה תחת הפורטפוליו של הפלטפורמה נדחה | לוודא במספר הראשון; fallback: "<מספרה> · Dominant"; ובסוף — מודל A ללקוח הזה |
| העלות פר-הודעה על הפלטפורמה (מודל B) | לשונית עלויות פר-עסק; תקרת הודעות במסלול; התראה ב-80% מהתקרה |

## 19. סיכום קבצים
**חדשים:** `src/lib/messaging/meta-cloud.ts`, `template-registry.ts`, `base-templates.ts`, `template-sync.ts`, `window.ts`, `inbound.ts`, `meta-rates.ts`; `src/app/api/webhook/meta/route.ts`; `src/app/api/admin/meta/connect/route.ts`; `src/app/api/admin/chats/[id]/send-template/route.ts`; `src/components/MetaConnectButton.tsx`.
**משתנים:** `prisma/schema.prisma`; `src/lib/messaging/{types,index,green-api}.ts`; `src/app/api/webhook/whatsapp/route.ts`; `src/app/api/cron/{drip-queue,reminders,reminders-2h,whatsapp-health}/route.ts`; `src/lib/waitlist-notify.ts`; `src/app/api/admin/{business,messaging/broadcast,chats/**,super/**,request-whatsapp}/route.ts`; `src/app/admin/{settings/whatsapp,chats,messaging,templates,super}/page.tsx`; `src/app/admin/AdminLayoutClient.tsx`; `src/lib/agent/owner-agent.ts`; `src/lib/super-admin.ts`.

**קשור:** `docs/PLAN-SAAS.md §E5` (שני ערוצים), `SPEC_SCALE.md:181-192`.

---

## 20. כלכלת ההודעות — תזכורת חכמה, ערוץ לפי סוג, מכסות (החלטות 20/09/2026)

> נכתב אחרי ספירה אמיתית ב-DOMINANT (30 יום עד 20/09): **1,002 תורים, 5,371 הודעות יוצאות = 5.36 לתור.** לפי קטגוריות מטא: 1,672 תשובות-בחלון, 2,667 תפעוליות, 398 אימות, **634 שיווקיות**. עלות משוערת אחרי 1/10: ~177 ₪/חודש, מתוכם **~82 ₪ (46%) על 12% הנפח השיווקי** (reengage 166, נודניקי-קצב 270, תפוצות 198). המסקנה שקבעה את הסעיף: המנוף הוא שליטה בקטגוריה השיווקית ובמספר ההודעות — לא קיצוץ תזכורות. יאיר כבר כיבה את נודניקי-הקצב בדומיננט.

### 20.0 העיקרון המוחלט — הכל רק ברשמי

**כל מה שבסעיף 20 קיים אך ורק כש-`Business.messagingProvider === "meta_cloud"`.** מבנית, לא הסכמית:
- ההגדרות של 20.1-20.4 **מוסתרות** במסך כשהעסק על Green, והקוד **מתעלם** מהן (מסלול Green לא קורא אותן).
- קרון התזכורות: הענף החכם נבחר רק אם `provider === meta_cloud && reminderMode === "smart"`; אחרת — הלוגיקה הקיימת (24 ש' + 2 ש') **ללא שינוי**.
- הקרון המרווח (drip, 1/דקה) נשאר ל-Green; ברשמי — בלי ריווח (סעיף 11). לא נוגעים.
- פוש-ואז-וואטסאפ (20.2) — רק ברשמי. הרחבה ל-Green כ-opt-in עתידי: מחוץ לסקופ.
- **קריטריון קבלה קבוע לכל משימה בסעיף זה:** עסק על Green — התנהגות זהה ביט-לביט לפני/אחרי.

### 20.1 מצב תזכורת חכמה

**למה 16 שעות:** החלון = 24 ש' מרגע שהלקוח עונה. תזכורת 24 ש' לפני → החלון נסגר בזמן התור. תזכורת 16 ש' לפני → לקוח מאשר ב-~15 ש' לפני → החלון פתוח עד **~9 ש' אחרי התור**, ומכסה: תזכורת 2 ש', "מתעכב", התור, "תדרג אותנו". **לחיצה על כפתור תגובה-מהירה נחשבת להודעה מהלקוח ופותחת חלון** — זה מה שמאפשר את הכול.

**הגדרות (Business.settings, ברשמי בלבד):**
- `reminderMode`: `"standard" | "smart"` — ברירת מחדל ברשמי: **`smart`**.
- `smartReminderHoursBefore`: מספר, ברירת מחדל **16** (טווח 12-24; יאיר: "אפשר גם 19").
- `smartSend2hToUnconfirmed`: bool, ברירת מחדל **false** (מתג: לשלוח 2 ש' גם למי שלא אישר, כתבנית בתשלום).

**החוקים:**
1. **T−16 ש'** (מותאם ללילה, ראה 20.1.1): תבנית תפעולית `appt_reminder_smart` עם כפתורי תגובה-מהירה **"אשר"** / **"בטל"**. זו ההודעה היחידה בזרימה שמשלמים עליה (~0.02).
2. לחץ **"אשר"** → `Appointment.customerConfirmation = "confirmed"`, `confirmedAt`. החלון נפתח. מכאן כל ההודעות לאותו לקוח **בתוך החלון** — service/utility-in-window — בלי תבנית, בזול/חינם (לפי התעריף החי, ראה 20.4).
3. **תזכורת 2 ש' — רק ל-`confirmed`.** אם `smartSend2hToUnconfirmed` → גם ל-`pending`, כתבנית `appt_reminder_2h` בתשלום.
4. לחץ **"בטל"** → `customerConfirmation = "declined"` → מפעיל את זרימת הביטול **הקיימת** (שחרור המשבצת, רשימת המתנה, הודעה לספר). לא לוגיקה חדשה.
5. **לא ענה** → `customerConfirmation` נשאר `"pending"`. **התור לא מתבטל.** מסומן ביומן (20.1.2). המטרה של האישור היא לפתוח שיחה, לא לסנן.
6. **קבע בתוך 16 השעות** (T−16 כבר עבר בזמן הקביעה): הודעת האישור-עם-כפתורים נשלחת ב-**T−2 ש'** ופותחת את החלון (במקום ה-2 ש' הרגילה). **קבע בתוך 2 השעות**: אישור התור עצמו נושא את הכפתורים (תבנית `appt_confirmation_smart`) — פותח חלון מיד. **קבע דרך הסוכן בוואטסאפ**: החלון כבר פתוח — ההודעות בפנים ממילא; הכפתורים עדיין נשלחים (לצורך הסימון).
7. **הסוכן לא נוגע באישור.** ניתוב נכנס (ב-`handleInboundMessage`, 10.3):
   - `button`/`interactive` עם payload `confirm_<apptId>` / `cancel_<apptId>` → טיפול **דטרמיניסטי** (חוקים 2/4). **הסוכן לא רץ.** נשמר כ-`ConversationMessage` (role user) לצורך התיעוד, `lastInboundAt` מתעדכן (פותח חלון, סעיף 8).
   - טקסט חופשי שתואם `/^\s*(מאשר|כן|אישור|אוקיי|ok|confirm)\s*$/i` **ויש לו תור pending ב-48 ש' הקרובות** → מסומן `confirmed` בקוד, בלי סוכן (תשובת service קצרה "מעולה, נתראה!"). חוסך טוקנים.
   - כל טקסט אחר → הזרימה הרגילה (סוכן, אם מופעל). הסוכן רואה בקונטקסט ש"הלקוח אישר/לא אישר תור" (הרחבת `loadCustomerContext`).
8. **נודניקי הסוכן** (`agent_followup`, `agent_question_followup`) ברשמי — **נשלחים רק אם החלון פתוח** (`isServiceWindowOpen`). חלון סגור → **מדולג** (לא תבנית, לא failed). מחזק את הכלל של סעיף 7 (service_only).

#### 20.1.1 לילה — לעולם לא
`target = appointmentStart − hoursBefore`. אם `target` בשעות השקט של העסק (ברירת מחדל 21:00-08:00 ישראל; להשתמש בהגדרה הקיימת של שעות-שקט של `question-followup`/drip, לא להמציא חדשה):
- אם `08:00 של אותו בוקר` ≥ 3 ש' לפני התור → לשלוח ב-08:00.
- אחרת → לשלוח ב-**21:00 של הערב הקודם** (מוקדם יותר, אבל ביום).
- מקרה קצה: תור ב-09:00 → T−16 = 17:00 יום קודם (תקין). תור ב-20:00 → T−16 = 04:00 → 08:00 (12 ש' לפני, תקין). תור ב-10:00 → T−16 = 18:00 יום קודם (תקין).
- ההודעה נכנסת ל-`MessageLog` עם `scheduledFor` המחושב; תור ה-drip ברשמי שולח בדיוק בזמן (סעיף 11).

#### 20.1.2 סימון ביומן
`Appointment.customerConfirmation` (`"pending" | "confirmed" | "declined"`, ברירת מחדל `pending` רק כשנשלחה בקשת אישור; `null` = לא נשלחה/Green). בכרטיס התור ביומן (`src/app/admin/page.tsx`, כרטיס התור המעוצב מ-`fd5d4ee`): תג קטן — ✅ אישר / ⏳ לא ענה / ❌ ביטל. פילטר "לא אישרו להיום" בראש היומן. **ב-Green: `null` → אין תג.** דוח יומי לבעלים: "X לא אישרו".

### 20.2 ערוץ לפי סוג הודעה — פוש קודם

**המנוף:** התראות פוש (Web Push, כבר קיים: `/api/push/*`, VAPID) **לא עולות כלום.** לכל סוג הודעה שלא חייב וואטסאפ — בחירה.

**הגדרה:** `channelByKind: Record<kind, "whatsapp" | "push_then_whatsapp" | "push_only" | "off">`, ברשמי בלבד. סוגים: `confirmation`, `first_booking`, `appointment_cancelled`, `appointment_moved`, `waitlist_notify`, `post_first_visit`, `post_every_visit`, `referral_thankyou`. **ברירות מחדל:** `waitlist_notify`, `appointment_cancelled`, `appointment_moved`, `post_*` → **`push_then_whatsapp`**; `confirmation`/`first_booking` → `whatsapp` (ראה 20.3). תזכורות, OTP, הסלמות, הצעות-החלפה — **תמיד וואטסאפ** (לא בבחירה; קריטיים).

**מימוש — ב-`deliverMessageLog` (סעיף 6), לפני מנוע התבניות:**
```
ch = channelByKind[log.kind] ?? "whatsapp"          // Green: תמיד "whatsapp" (לא קורא את ההגדרה)
if ch === "off" → skipped:"channel_off"
if ch startsWith "push":
   sub = pushSubscriptionFor(business.id, log.customerPhone)   // Customer ↔ PushSubscription (קיים)
   if sub → sendPush(sub, title, body, url) → MessageLog.channel="push", status per push result → return
   if ch === "push_only" → skipped:"no_push_subscription"
   // push_then_whatsapp ללא מנוי → נופל לוואטסאפ למטה
→ המשך כרגיל (חלון/תבנית) ; MessageLog.channel="whatsapp"
```
- שדה חדש `MessageLog.channel` (`"whatsapp" | "push"`, ברירת מחדל `whatsapp`). פוש **לא נספר במכסה** (20.4) — זה כל הרעיון.
- מד השימוש מציג "X נשלחו בפוש (חינם), Y בוואטסאפ".

### 20.3 אישור מיידי — כבחירה
`sendImmediateConfirmation`: bool, ברירת מחדל **true**. כש-`false` (ברשמי): קביעה מהאתר → **בלי** וואטסאפ מיידי — המסך מאשר, פוש אם יש, והתזכורת החכמה (T−16) היא הנגיעה הראשונה בוואטסאפ. קביעה דרך הסוכן → האישור הוא תשובת-הסוכן בחלון (זול) — לא מושפע. שווה ~0.76 הודעה לתור. סיכון UX (לקוח לא בטוח שנקלט) → לכן ברירת מחדל דלוק; מי שרוצה לחסוך מכבה, עם הסבר במסך.

### 20.4 מכסה, חבילות, שדרוג, הערכת סיום

**מודל:** "קרדיטים של הודעות". הרחבת `TIER_QUOTAS` ב-`src/lib/tier.ts` (קיים: `aiConversations`, `broadcasts`) בשדה **`waCredits`**. משקל: service/utility/authentication = **1**, marketing = **6** (יחס העלות ~0.02:0.13). פוש = 0. **מספרי מכסה לכל מסלול — להגדיר עם יאיר מהנתונים** (דומיננט ≈ 1,000 תורים ≈ 5,400 הודעות ≈ 8,500 קרדיטים/חודש כשהנודניקים כבויים). הצעת פתיחה: basic 3,000 / pro 10,000 / premium 25,000. **לא לקבע לפני אישור.**

**ספירה:** מ-`MessageLog` (ברשמי, `channel="whatsapp"`, סטטוס לא failed/skipped) בחודש הקלנדרי: קטגוריה = `costCategory` מה-webhook כשקיים, אחרת לפי הרישום (סעיף 7). פונקציה `monthlyCredits(businessId)` ב-`src/lib/messaging/quota.ts` (חדש).

**הערכת סיום:** `rate = used / daysElapsed`; `projectedTotal = rate × daysInMonth`; `runoutDate = today + (included − used) / rate` (אם `rate>0` ו-`used<included`). מוצג: "בקצב הנוכחי החבילה נגמרת ב-~24/9" או "צפוי להישאר בתקציב". מתעדכן יומית (ב-`whatsapp-health` cron או בקריאה).

**התראות:** 80% → פוש+וואטסאפ לבעלים + לוג ל-super. 100% → הודעה עם שתי אפשרויות: חבילה נוספת / שדרוג.

**מדיניות במכסה מלאה (החלטה 7):**
- **תפעולי + אימות + service — ממשיכים.** נספרים כ-`overageCredits` ומחויבים (או נכללים בחבילה הבאה). **תזכורת לעולם לא נעצרת בגלל מכסה.**
- **שיווקי + תפוצות — נעצרים:** ב-enqueue של תפוצה/reengage/`post_*` פרומו → `status="awaiting_quota"` (סטטוס חדש, לצד `awaiting_template` מ-9.4). ברכישת חבילה/שדרוג → `awaiting_quota → scheduled`. ב-UI: "ממתין למכסה".

**חבילות:** `Business.waCreditsExtra` (int, מתאפס בתחילת חודש → לא: נשאר עד ניצול; פשוט יותר: **לא מתאפס**) + טבלת `CreditPurchase` (businessId, credits, price, createdAt, source: `pack|upgrade|manual`). super יכול להוסיף ידנית. תשלום — מחוץ לסקופ הקוד הזה (חשבונית ידנית בבטא; חיבור סליקה בהמשך).

**super — לשונית עלויות (12.2, הרחבה):** לכל עסק: קרדיטים בשימוש / כלולים / חריגה; עלות מטא בפועל (`costCategory`×תעריף מ-`meta-rates.ts`); **מרווח** = מחיר המסלול − עלות בפועל. זה המספר שיאיר צריך כדי לתמחר.

**תעריף חי:** לפני קיבוע "חינם/0.02" בטקסטים למשתמש — למשוך את rate card של מטא לישראל (מצב אחרי 1/10/2026). `meta-rates.ts` = מקור יחיד, ניתן לעדכון.

### 20.5 מסך ההגדרות — "הודעות ועלויות"
מסך אחד (`/admin/settings/messages`, חדש, או לשונית ב-`settings/whatsapp`), **מוצג במלואו רק ברשמי**. ב-Green: רק כרטיס 1 עם "עבור לוואטסאפ רשמי" (12.1).
1. **ערוץ** — לא רשמי (QR) / רשמי + סטטוס (12.1).
2. **תזכורות** — רגילה/חכמה · "כמה שעות לפני" (12-24, ברירת מחדל 16, הערה "לא נשלח בלילה") · מתג "2 ש' גם למי שלא אישר (בתשלום)".
3. **הודעות לפי סוג** — שורה לכל kind מ-20.2 עם בורר וואטסאפ / פוש-ואז-וואטסאפ / פוש בלבד / כבוי · מתג "אישור מיידי בוואטסאפ" (20.3) עם הסבר החיסכון.
4. **מכסה ושימוש** — מד (כלול/בשימוש/חריגה), פירוט תפעולי/שיווקי/פוש-חינם, **הערכת מועד סיום**, כפתורי "חבילה נוספת" / "שדרוג", היסטוריית רכישות.

### 20.6 עתידי — מספר משותף למסלול הזול (לא בסקופ)
מתקן את החלטה 4 **רק** למסלול הזול ביותר: מספר פלטפורמה אחד לעסקים קטנים, תחת אותו WABA (מודל B). טכנית מוכן: תבניות הבסיס נושאות `{{business}}`. מחיר: (א) שם התצוגה = הפלטפורמה, לא המספרה; (ב) דירוג איכות ומגבלת נפח משותפים לכל העסקים על המספר; (ג) ניתוב נכנס לפי `phone_number_id` **לא מספיק** — צריך זיהוי עסק לפי הקשר (הלקוח שייך לאיזה עסק) — נקודה פתוחה. יאיר: "בהתחלה לא ניצור מנוי כזה, רק מתקדמים, ואז נרד לזול." לתכנן כשמגיעים.

### 20.7 משימות — שלב 1.5 (אחרי שלב 1, לפני שלב 2)
| # | משימה | קבצים | קבלה |
|---|---|---|---|
| 1.5.1 | Schema: `Appointment.customerConfirmation`+`confirmedAt`; `MessageLog.channel`; `CreditPurchase`; `Business.waCreditsExtra`; מפתחות settings (`reminderMode`, `smartReminderHoursBefore`, `smartSend2hToUnconfirmed`, `channelByKind`, `sendImmediateConfirmation`); `TIER_QUOTAS.waCredits` | `prisma/schema.prisma`, `src/lib/tier.ts` | `db push`+`tsc` נקי; Green: אפס שינוי |
| 1.5.2 | תבניות בסיס עם כפתורים: `appt_reminder_smart`, `appt_confirmation_smart` (quick-reply אשר/בטל, payload `confirm_<id>`/`cancel_<id>`) + רישום ב-`template-registry` | `base-templates.ts`, `template-registry.ts` | מאושרות ב-WABA; כפתור מגיע כ-`button` ב-webhook |
| 1.5.3 | מתזמן חכם: ענף `smart` בקרון התזכורות — T−N מותאם ללילה (20.1.1), 2 ש' רק ל-confirmed (+מתג), קביעה מאוחרת (חוק 6) | `cron/reminders/route.ts`, `cron/reminders-2h/route.ts`, `appointments/route.ts` (יצירה) | תור ל-20:00 → תזכורת ב-08:00; לא-מאשר לא מקבל 2 ש' (אלא במתג); Green: הלוגיקה הישנה |
| 1.5.4 | ניתוב אישור נכנס: כפתור→דטרמיניסטי, regex→confirm בלי סוכן, אחר→סוכן; קונטקסט "אישר/לא" לסוכן | `lib/messaging/inbound.ts` (10.3), `customer-agent.ts` (`loadCustomerContext`) | לחיצה מסמנת בלי קריאת סוכן (לוג 0 טוקנים); "בטל" מפעיל ביטול קיים |
| 1.5.5 | סימון ביומן + פילטר "לא אישרו" + שורה בדוח יומי | `admin/page.tsx`, `cron/report-daily` | תג נכון לכל מצב; Green: אין תג |
| 1.5.6 | ערוץ לפי סוג + פוש-קודם ב-`deliverMessageLog`; `pushSubscriptionFor`; `MessageLog.channel` | `messaging/index.ts`, `lib/push/*` (קיים), `messaging/quota.ts` | לקוח עם פוש מקבל פוש ולא וואטסאפ; בלי פוש → וואטסאפ; `channel` נרשם |
| 1.5.7 | אישור מיידי כמתג בכל נתיבי יצירת תור (`/book`, אדמין, סוכן) | `appointments/route.ts`, `admin/appointments/*`, tools של הסוכן | כבוי → אין `confirmation` בוואטסאפ מהאתר; סוכן לא מושפע |
| 1.5.8 | נודניקי סוכן ברשמי — רק בחלון פתוח | `agent/question-followup.ts`, `conversation-followup` | חלון סגור → skipped, לא failed, לא תבנית |
| 1.5.9 | מנוע מכסה: `monthlyCredits`, הערכת סיום, התראות 80/100, `awaiting_quota` לשיווקי, `overageCredits` לתפעולי, `CreditPurchase` | `messaging/quota.ts` (חדש), `drip-queue`, `broadcast/route.ts`, `cron/reengage`, `cron/whatsapp-health` | תזכורת נשלחת גם ב-101%; תפוצה ב-101% → ממתינה; רכישה משחררת |
| 1.5.10 | מסך "הודעות ועלויות" (20.5) + לשונית מרווח ב-super (20.4) | `admin/settings/messages/page.tsx` (חדש), `super/page.tsx`, `super/usage/route.ts` | Green: רק כרטיס ערוץ; רשמי: 4 קבוצות; הערכת סיום מוצגת |

**קבלה לשלב 1.5 (על DOMINANT ברשמי):** (א) תור למחר 10:00 → תזכורת ב-18:00 היום עם כפתורים; לחיצה "אשר" מסמנת בלי סוכן; ב-08:00 תזכורת 2 ש' חופשית בחלון; (ב) תור ל-20:00 → תזכורת ב-08:00 (לא ב-04:00); (ג) לא-מאשר → תג ⏳ ביומן, לא בוטל, אין 2 ש' (עד שהמתג דלוק); (ד) ביטול תור → לקוח עם פוש מקבל פוש בלבד, `channel=push`, לא נספר; (ה) מכסה מלאה → תזכורת יוצאת, תפוצה ממתינה; (ו) מד מציג הערכת סיום; (ז) **עסק על Green — זהה ביט-לביט**; (ח) `tsc`+build ירוקים.

**סדר מומלץ:** 1.5.1 → 1.5.2 → 1.5.4 → 1.5.3 → 1.5.5 (הזרימה החכמה שלמה) → 1.5.6 → 1.5.7 → 1.5.8 → 1.5.9 → 1.5.10.

**תלות:** שלב 1.5 יושב על שלב 1 (ספק מטא, `deliverMessageLog`, חלון, `handleInboundMessage`, תבניות). אפשר לפתח את 1.5.1/1.5.5/1.5.9/1.5.10 במקביל לשלב 1; 1.5.2-1.5.4/1.5.6-1.5.8 אחרי 1.4/1.6/1.7/1.9.
