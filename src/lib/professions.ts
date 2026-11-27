/**
 * Professions outside hair and beauty (27.11.2026, Yair: "תכין את הסוכן גם לתחומים האלו"): picked at signup
 * instead of the domains. Each one gives the business its words, the rules the agent starts from (the owner
 * edits them in the setup), and a starter list of services with market prices and durations.
 */
import type { BusinessType, Vocab } from "@/lib/vocab";

export type Profession = {
  id: string; label: string; businessType: BusinessType;
  vocab: Record<string, string | boolean>;
  rules: string;
  catalog: Vocab["serviceCatalog"];
};

export const PROFESSIONS: ReadonlyArray<Profession> = [
  { id: "vet", label: "וטרינר", businessType: "other",
    vocab: { placeKind: "מרפאה וטרינרית", place: "מרפאה", placeDef: "המרפאה", staff: "וטרינר", staffPlural: "וטרינרים", defaultService: "בדיקה כללית", serviceExamples: "בדיקה, חיסון, שבב" },
    rules: "התור נקבע על שם בעל החיים: לשאול את שמו ומה הוא (כלב, חתול). מצב חירום (הרעלה, דימום, קושי לנשום, פגיעה מרכב, פרכוס): לא קובעים תור, אומרים להגיע מיד או להתקשר. ניתוח רק אחרי בדיקה. ניקוי שיניים בהרדמה: צום מהלילה.",
    catalog: [
      { category: "בדיקות", name: "בדיקה כללית", price: 250, duration: 20 },
      { category: "חיסונים", name: "חיסון שנתי", price: 180, duration: 15, rebookDays: 365 },
      { category: "חיסונים", name: "שבב וחיסון כלבת", price: 220, duration: 20 },
      { category: "טיפולים", name: "ניקוי שיניים בהרדמה", price: 900, duration: 90, priceFrom: true, about: "המחיר הסופי לפי גודל ומצב השיניים" },
      { category: "ניתוחים", name: "עיקור או סירוס", price: 1100, duration: 120, priceFrom: true, consultFirst: true, about: "המחיר לפי גודל ומין" },
    ] },
  { id: "dog_grooming", label: "מספרת כלבים", businessType: "other",
    vocab: { placeKind: "מספרה לכלבים", place: "מספרה", placeDef: "המספרה", staff: "ספר כלבים", staffPlural: "ספרי כלבים", defaultService: "תספורת כלב", serviceExamples: "תספורת, מקלחת, ציפורניים" },
    rules: "התור על שם הכלב: לשאול את שמו, הגזע או המשקל, כי הם קובעים את המחיר ואת המשך. כלב תוקפני או שלא סופר אף פעם: לומר לפני כן. כלב בלי חיסונים בתוקף לא מתקבל.",
    catalog: [
      { category: "תספורת", name: "תספורת כלב קטן", price: 180, duration: 60, rebookDays: 42, about: "עד 10 קילו" },
      { category: "תספורת", name: "תספורת כלב בינוני", price: 240, duration: 90, rebookDays: 42, about: "10 עד 25 קילו" },
      { category: "תספורת", name: "תספורת כלב גדול", price: 320, duration: 120, rebookDays: 42, priceFrom: true, about: "מעל 25 קילו, המחיר לפי הפרווה" },
      { category: "טיפוח", name: "מקלחת וסירוק", price: 130, duration: 45, rebookDays: 28 },
      { category: "טיפוח", name: "גזירת ציפורניים", price: 40, duration: 15 },
    ] },
  { id: "driving", label: "מורה לנהיגה", businessType: "other",
    vocab: { placeKind: "בית ספר לנהיגה", place: "בית ספר", placeDef: "בית הספר", staff: "מורה", staffPlural: "מורים", customer: "תלמיד", customerPlural: "תלמידים", defaultService: "שיעור נהיגה", serviceExamples: "שיעור נהיגה, שיעור כפול, טסט פנימי" },
    rules: "שיעור ראשון רק עם תאוריה בתוקף. לשאול מאיפה לאסוף. ביטול פחות מ-24 שעות לפני: השיעור מחויב. הורה שקובע לילד: רושמים את שם התלמיד.",
    catalog: [
      { name: "שיעור נהיגה", price: 160, duration: 40, rebookDays: 7 },
      { name: "שיעור כפול", price: 310, duration: 80, rebookDays: 7 },
      { name: "טסט פנימי", price: 250, duration: 40 },
      { name: "שיעור ריענון", price: 180, duration: 40, about: "למי שיש רישיון ולא נהג הרבה זמן" },
    ] },
  { id: "spa", label: "עיסוי וספא", businessType: "cosmetics",
    vocab: { placeKind: "ספא", place: "ספא", placeDef: "הספא", staff: "מעסה", staffPlural: "מעסים", defaultService: "עיסוי שוודי", serviceExamples: "עיסוי שוודי, רקמות עמוק, עיסוי זוגי", staffFem: false },
    rules: "עיסוי זוגי: שני מעסים באותה שעה, באותו חדר. בהריון: רק עיסוי הריון, אחרי השבוע ה-14. לשאול אם יש פציעה או רגישות. להגיע 10 דקות לפני.",
    catalog: [
      { category: "עיסויים", name: "עיסוי שוודי", price: 320, duration: 60, rebookDays: 30 },
      { category: "עיסויים", name: "עיסוי רקמות עמוק", price: 380, duration: 60, rebookDays: 30 },
      { category: "עיסויים", name: "עיסוי הריון", price: 340, duration: 60, specialist: true },
      { category: "עיסויים", name: "עיסוי אבנים חמות", price: 420, duration: 75 },
      { category: "זוגי", name: "עיסוי זוגי", price: 700, duration: 60, about: "שני מטופלים, שני מעסים, אותו חדר" },
    ] },
  { id: "laser", label: "הסרת שיער בלייזר", businessType: "cosmetics",
    vocab: { placeKind: "קליניקה להסרת שיער בלייזר", place: "קליניקה", placeDef: "הקליניקה", staff: "מטפלת", staffPlural: "מטפלות", defaultService: "ייעוץ וטסט", serviceExamples: "בית שחי, רגליים, גב" },
    rules: "לקוח חדש: קודם ייעוץ וטסט, והטיפול הראשון לפחות שבוע אחרי. בין טיפול לטיפול באותו אזור לפחות 4 שבועות. בלי שיזוף שבועיים לפני. לא בהריון. לגלח יום לפני.",
    catalog: [
      { category: "ייעוץ", name: "ייעוץ וטסט", price: 0, duration: 15 },
      { category: "נשים", name: "בית שחי", price: 150, duration: 15, rebookDays: 35, consultFirst: true },
      { category: "נשים", name: "רגליים מלאות", price: 450, duration: 45, rebookDays: 42, consultFirst: true },
      { category: "נשים", name: "מפשעה מלאה", price: 250, duration: 20, rebookDays: 35, consultFirst: true },
      { category: "גברים", name: "גב וכתפיים", price: 400, duration: 30, rebookDays: 42, consultFirst: true },
      { category: "גברים", name: "זקן עליון ולחיים", price: 200, duration: 15, rebookDays: 35, consultFirst: true },
    ] },
  { id: "tutor", label: "שיעורים פרטיים", businessType: "other",
    vocab: { placeKind: "מרכז שיעורים פרטיים", place: "מרכז", placeDef: "המרכז", staff: "מורה", staffPlural: "מורים", customer: "תלמיד", customerPlural: "תלמידים", defaultService: "שיעור פרטי", serviceExamples: "מתמטיקה, אנגלית, הכנה לבגרות" },
    rules: "הורה שקובע לילד: רושמים את שם הילד ואת הכיתה. לשאול אם במרכז או בזום. שיעור ראשון: שיעור ניסיון. ביטול פחות מ-12 שעות לפני מחויב.",
    catalog: [
      { name: "שיעור ניסיון", price: 80, duration: 45 },
      { name: "שיעור יסודי", price: 120, duration: 45, rebookDays: 7 },
      { name: "שיעור חטיבה ותיכון", price: 160, duration: 60, rebookDays: 7 },
      { name: "הכנה לבגרות", price: 190, duration: 90, rebookDays: 7 },
    ] },
];

export const professionOf = (id: unknown): Profession | undefined => PROFESSIONS.find(p => p.id === id);
