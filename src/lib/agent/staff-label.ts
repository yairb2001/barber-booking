/** A staff member's short name. A title is not a name (25.11.2026, a clinic:
 *  every doctor's first word was "ד"ר", so five people looked like one). */
const TITLE = /^(?:ד["״'׳]?ר\.?|פרופ['׳]?\.?|dr\.?|prof\.?)\s+/i;

/** The first name without a title: the key for "two people with the same name". */
export const staffFirst = (name: string): string => name.trim().replace(TITLE, "").split(/\s+/)[0];

/** What to call them in a list: the first name, with the title kept ("ד"ר רון"). */
export const staffShort = (name: string): string => `${name.trim().match(TITLE)?.[0] ?? ""}${staffFirst(name)}`;
