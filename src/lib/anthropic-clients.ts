import Anthropic from "@anthropic-ai/sdk";

/**
 * Two Claude keys (Yair, 9.10.2026: "לכל הבדיקות והטסטים יהיה לנו מפתח api אחר").
 *
 *   prod — the agents that talk to real customers and leads (ANTHROPIC_API_KEY).
 *   test — every sandbox run: the owner's "try the agent", the setup wizard's
 *          preview, replays and QA runs (ANTHROPIC_API_KEY_TEST). Its spend is
 *          billed separately and never eats a business's token package.
 *
 * Until the test key is set, test runs fall back to the production key so
 * nothing breaks; `hasTestKey()` lets the CRM show that the split is not on yet.
 */
const opts = {
  // Transient 429/5xx/"overloaded" are common under load; left unretried they
  // leave a customer with no reply at all.
  maxRetries: 4,
};

const prod = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, ...opts });
const testKey = process.env.ANTHROPIC_API_KEY_TEST?.trim();
const test = testKey ? new Anthropic({ apiKey: testKey, ...opts }) : null;

export function anthropicFor(purpose: "prod" | "test"): Anthropic {
  return purpose === "test" && test ? test : prod;
}

export function hasTestKey(): boolean {
  return !!test;
}
