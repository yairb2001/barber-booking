/**
 * A man writing to a business whose customers are mostly women (27.11.2026): the code turned its fixed
 * "מאשר?" into "מאשרת?" for everyone, so "אהלן אחי … מאשר" got "מאשרת?" back, in four beauty trades.
 * Text only: his own words about himself, or a man's first name he gave. A woman's word wins.
 */
const SEP = "(?:^|$|[\\s,.!?;:()\"'])";
const as = (words: string) => new RegExp(`(?<=${SEP})(?:${words})(?=${SEP})`);
const MAN = as("אחי|אשתי|לאשתי|צריך|מעוניין|מאשר|לגברים|גבר");
const WOMAN = as("בעלי|לבעלי|צריכה|מעוניינת|מאשרת|אחותי");
// Names that are only men's (no טל, שי, עדי, אור), read where he gives his own name: a line that starts with
// it, or after "שמי" / "אני" / "קוראים לי". "אצל אורי" names a staff member, not him.
const MEN_NAMES = new Set(("אבי אברהם אהרון אחמד איתי איתן אלון אליאור אליהו אלעד אמיר אסף אריאל ארז בועז גיא דביר דוד דני דניאל הראל זיו חיים יאיר יגאל יהודה יואב יונתן יוסי יוסף ינון יעקב ירון ישי ישראל כפיר מוחמד מוטי מיכאל מנחם משה ניר נדב נועם עומר עידו עמית עמרי ערן צחי קובי רביד רון רועי שגיא שחר שלומי שמעון שמואל תומר")
  .split(" "));
const OWN_NAME = /(?<=(?:^|\n|שמי|אני|קוראים לי|שם)\s*[:,]?\s*)[א-ת]+/g;

export function writesAsMan(texts: string[]): boolean {
  const all = texts.join("\n");
  if (WOMAN.test(all)) return false;
  return MAN.test(all) || (all.match(OWN_NAME) ?? []).some(w => MEN_NAMES.has(w));
}
