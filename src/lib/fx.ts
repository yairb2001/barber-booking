/**
 * One dollar-to-shekel rate for every cost the app shows or meters (agent
 * tokens, the CRM's money card, Meta message costs). AI and Meta bill in USD.
 * Bank of Israel representative rate ~3.07 on 8.10.2026; set USD_ILS in the
 * environment to move it without a deploy. Before this, three places used
 * 3.65 / 3.7 / 3.3 — token packages ran out ~19% early.
 */
export const USD_ILS = Number(process.env.USD_ILS) || Number(process.env.TOKEN_USD_ILS) || 3.07;
