# DOMINANT — iOS Native App (Capacitor)

האפליקציה הנטיבית של DOMINANT עוטפת את ממשק הניהול הפעיל ב-Vercel
(`https://barber-booking-indol.vercel.app/admin`) ב-WebView, ומוסיפה לו
יכולות נטיביות: Push Notifications, Status Bar ממותג, Haptics, ושיתוף נטיבי.

---

## 📦 מה כבר הוגדר

- ✅ `capacitor.config.ts` — מצביע על ה-Vercel URL
- ✅ פלטפורמת iOS נוצרה תחת `ios/`
- ✅ Plugins מותקנים:
  `@capacitor/app`, `@capacitor/device`, `@capacitor/haptics`,
  `@capacitor/push-notifications`, `@capacitor/share`,
  `@capacitor/splash-screen`, `@capacitor/status-bar`
- ✅ Info.plist — Display Name, הרשאות מצלמה/תמונות/אנשי קשר, Background push
- ✅ Native bridge — `src/lib/native/bridge.ts` + `useNativeShell()`
- ✅ Endpoint לשמירת push token — `/api/admin/native/device`

---

## 🛠️ דרישות לפני הבנייה

| כלי | איך | מקור |
|---|---|---|
| **Xcode 15+** | App Store (חינמי, ~10GB) | App Store |
| **Apple Developer Account** | $99/שנה | [developer.apple.com](https://developer.apple.com/programs/) |
| **CocoaPods** *(אם Xcode מבקש)* | `sudo gem install cocoapods` | Terminal |

---

## 🚀 שלבי הפעלה ראשונית

```bash
# 1. ודא שהכל מסונכרן
npx cap sync ios

# 2. פתח את הפרויקט ב-Xcode
npm run ios:open
```

ב-Xcode:

1. **בחר את ה-target "App"** מהרשימה השמאלית
2. **General → Signing & Capabilities**
   - בחר את ה-Team שלך (Apple Developer Account)
   - שנה את `Bundle Identifier` ל-`com.YOURNAME.dominant`
     (החלף `YOURNAME` במשהו ייחודי — לדוגמה `com.yairb.dominant`)
3. **Capabilities → +Capability → Push Notifications** (לחיצה כפולה להוספה)
4. **Capabilities → +Capability → Background Modes → Remote notifications**
5. **בחר סימולטור** (iPhone 15 Pro לדוגמה) ולחץ **▶ Run**

---

## 📱 בנייה למכשיר פיזי

1. חבר אייפון בכבל
2. ב-Xcode בחר את המכשיר מהרשימה למעלה
3. אמת אמון: `Settings → General → VPN & Device Management` באייפון → בחר את ה-developer profile → Trust
4. **▶ Run** ב-Xcode

---

## 🌍 העלאה ל-App Store

1. **Apple Developer Console** → צור App ID חדש עם ה-Bundle Identifier שבחרת
2. **App Store Connect** ([appstoreconnect.apple.com](https://appstoreconnect.apple.com))
   - **My Apps → +** → Add New App
   - Name: **DOMINANT**, Bundle ID: שבחרת, SKU: `dominant-admin`
   - Primary Language: Hebrew (Israel)
3. **ב-Xcode:**
   - Product → Archive (ייקח כמה דקות)
   - בחלון Organizer → **Distribute App → App Store Connect → Upload**
4. **App Store Connect:**
   - מלא מסך מטא־נתונים (תיאור, צילומי מסך, סיווג גיל, מדיניות פרטיות)
   - לחץ **Submit for Review**
   - Apple עונים בדרך כלל תוך 24–48 שעות

### צילומי מסך נדרשים (מינימום)
- 6.7" (iPhone 15 Pro Max) — 1290×2796
- 5.5" (iPhone 8 Plus)  — 1242×2208
- אפשר לעשות screenshot מסימולטור: ⌘+S

---

## 🔔 Push Notifications — חיבור ל-APNs (Apple Push Notification service)

האפליקציה רושמת token אוטומטית, אבל לשליחת push בפועל צריך:

1. **Apple Developer Console** → Keys → **+** → Apple Push Notifications service (APNs)
2. הורד את הקובץ `.p8` ושמור בטוח (לא ב-git!)
3. רשום את ה-`Key ID` ואת ה-`Team ID`
4. בעתיד: צריך לבנות endpoint `POST /api/admin/push/send` שמשתמש ב-APNs כדי לשלוח push לכל ה-tokens שנשמרו ב-`Staff.settings.pushTokens` / `Business.settings.ownerPushTokens`.

> פיתוח Push API מלא לא חלק מההגדרה הראשונית — מתחילים בלי, מוסיפים אחרי שהאפליקציה פעילה.

---

## 🐛 בעיות נפוצות

| בעיה | פתרון |
|---|---|
| "No signing certificate found" | בחר Team ב-Signing & Capabilities |
| Build fails on `pod install` | `cd ios/App && pod install` ידנית |
| Status bar שחור / חופף | ה-`capacitor.config.ts` קובע `style: DARK` — שנה אם צריך |
| לא מקבל push | ודא שאתה על מכשיר פיזי (לא סימולטור) + Capability מופעל + Apple Developer בתשלום |
| ה-WebView לא טוען | בדוק שהאינטרנט פעיל. ה-app טוען מ-`barber-booking-indol.vercel.app` |

---

## 🔁 עדכוני קוד שוטפים

**רוב העדכונים לא דורשים build חדש של האפליקציה!**
האפליקציה טוענת מ-Vercel — כל push ל-GitHub מתעדכן מיד אצל המשתמשים.

build חדש (ושליחה ל-TestFlight/App Store) צריך רק כאשר:
- שינוי הגדרות Capacitor (`capacitor.config.ts`)
- הוספת/הסרת plugin
- שינוי הרשאות (`Info.plist`)
- שינוי icon / splash
- שינוי גרסה (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` ב-Xcode)

---

## 📂 מבנה הקבצים החשובים

```
capacitor.config.ts                              # הגדרת Capacitor (URL, plugins, splash)
public/native-shell/index.html                   # fallback HTML (לא בשימוש בפועל)
src/lib/native/bridge.ts                         # API ל-Web→Native (push, haptics, share)
src/lib/native/useNativeShell.ts                 # Hook להרשמת push בעת login
src/app/api/admin/native/device/route.ts         # Endpoint לשמירת push tokens
ios/App/App/Info.plist                           # שם תצוגה, הרשאות, capabilities
ios/App/App/Assets.xcassets/                     # App icon + Splash
ios/assets/branding.md                           # מדריך החלפת אייקון/splash
```

---

## ✅ Checklist לפני App Store submission

- [ ] Apple Developer Account פעיל
- [ ] Bundle Identifier ייחודי הוגדר ב-Xcode
- [ ] Team חתימה מוגדר
- [ ] Push Notifications capability מופעל
- [ ] App Icon 1024×1024 הוחלף (לא placeholder)
- [ ] Splash Screen הוחלף (אופציונלי לאלפא)
- [ ] תיאור באנגלית + עברית מוכן
- [ ] צילומי מסך לכל גדלי האייפון
- [ ] מדיניות פרטיות זמינה ב-URL ציבורי
- [ ] קטגוריה: **Business** או **Productivity**
- [ ] Test build רץ במכשיר אמיתי
- [ ] רשום Push token נשמר ב-DB אחרי login

