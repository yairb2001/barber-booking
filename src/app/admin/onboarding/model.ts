/**
 * The wizard's team and services as the owner edits them (28.10.2026, spec
 * "הקמה עצמית ליופי"): each person with her gender, domains and days, each
 * service with who does it. Nothing here talks to the server.
 */
import type { Domain } from "@/lib/domains";

export type Gender = "" | "m" | "f" | "x";
/** daysEdited: she changed them in this visit (only then a saved person's week is written again). */
export type Member = { key: string; id?: string; name: string; phone: string; gender: Gender; domains: Domain[]; days: boolean[]; daysEdited?: boolean };
export type Svc = {
  id?: string; name: string; price: string; duration: string; category?: string; priceFrom?: boolean; rebookDays?: number;
  about?: string; domain?: Domain; segments?: { m: number; busy: boolean }[]; bufferAfterMin?: number; specialist?: boolean; consultFirst?: boolean;
  /** Member keys she picked; null = everyone in the service's domain (a specialist service: nobody until she picks). */
  who: string[] | null;
  /** Who does it in the database, for a saved service: only the difference is sent. */
  savedWho?: string[];
};

let seq = 0;
export const newMember = (domains: Domain[], days: boolean[]): Member =>
  ({ key: `new-${Date.now()}-${seq++}`, name: "", phone: "", gender: "", domains: domains.length === 1 ? domains : [], days });

export const whoOf = (s: Svc, members: Member[]): string[] =>
  s.who ?? (s.specialist ? [] : members.filter(m => !s.domain || m.domains.includes(s.domain)).map(m => m.key));

/** Minutes she is free in the middle of it (colour setting). */
export const waitOf = (s: Svc) => (s.segments ?? []).filter(g => !g.busy).reduce((a, g) => a + g.m, 0);
