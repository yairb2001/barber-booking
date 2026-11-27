# Rules for changing the customer agent

For anyone who changes how the agent talks or books, in every business: the fix
agent (docs/fix-agent.md), a session that edits `prompt-template.ts`, or one that
adds a guard in `customer-agent.ts`. Learned from three rounds of simulated
customers over 21 business types (25.11 to 27.11.2026, about 650 chats). Each
rule names the case that taught it. Read it before you plan a fix.

## 1. Choose where the fix lives

- **Something that must always happen goes in code, not in another prompt line.**
  The model skips a prompt rule in some chats, and every line costs characters for
  every business. Examples that only code solved: a free hour answered as "not
  free", the fixed confirmation question, the crisis line (ער"ן 1201), the reply
  language. Pattern: let the model answer, then check the reply in code and
  replace it with a fixed line when it is wrong.
- **One business's taste or fact goes in its own data** (setup, faq, rules), never
  in the base template. The base changes only for a bug, or when the same problem
  shows in two businesses or more.
- **A line that matters only to some businesses is added only to them.** The
  consult-first rule now appears only when a service needs a consultation (27.11,
  saved hundreds of characters for everyone else).
- **No data means no answer, not an invented one.** The agent invented a clinic
  phone, "no packages", "we cover old tattoos" and Hanukkah dates. When the
  business has no field for it, the fix is an honest sentence plus a question to
  the owner, or a real field. Never a plausible guess.

## 2. Keep the prompt inside its budget

- At most 15,000 characters per business, growth of more than 100 needs Yair's
  approval (docs/fix-agent.md). **Replace or merge, never append.**
- **Measure every kind of business, not only the one you fixed.** Round 1 added
  402 characters to every business except men's barbershops, and nobody saw it,
  because only DOMINANT was measured. Measure at least: DOMINANT, a plain shop, a
  women's salon, a full beauty salon, a clinic, and one of the new trades.
- **Catalog ids:** the catalog shows 8-character ids, and `withRealIds` maps them
  back before any tool runs. A new tool argument that holds an id must go through
  it.

## 3. Roll out in stages

1. **Trial first.** A new behavior runs behind `onTrial(settings)` (test
   businesses only) until the re-test passes. `widerContext` (everyone except
   DOMINANT) comes only after Yair's yes, and what DOMINANT's customers see changes only
   with his yes for DOMINANT.
2. **Prove that the trial stage changed nothing real.** Before you push stage 1,
   hash the prompt, the tools and the catalog of every real business with the old
   code and the new code. They must be identical.
3. **After every deploy:** wait for `/api/version` to show the commit, run the
   health check, and run one DOMINANT sandbox turn that books.

## 4. Guards that check the reply (the code after the model)

- **Narrow, and tested on real texts.** The invented-phone guard joined all the
  digits of the context, so almost every number looked "known". Check each value
  on its own.
- **Every language.** A guard written with Hebrew words misses Arabic, Russian and
  English customers. "сколько стоит?" and "قديش السعر؟" were dropped because the
  price check knew only "כמה זה". Add the other languages to the pattern and to
  the test.
- **Code sends Hebrew.** Every fixed line (the confirmation, "סגור, קבעתי",
  fallbacks) reaches foreign-language customers too, so it passes through the
  translation. A translation that is not in the customer's script is dropped, and
  the original is kept (once the model sent a note in English instead).
- **A fixed line replaces what the model wrote, so check what else he asked.**
  The fixed confirmation question dropped a price asked in the same message. When
  code sends a fixed line, answer the rest of his message first.
- **Words of the trade.** An animal emergency is not 101 (that is for people). A
  clinic has no "ספר". Address women in the feminine. Use the business's
  vocabulary for every new line.
- **Facts the model cannot compute come from code.** Holiday dates, "מחרתיים"
  versus "מחר" (also in translation), whether an hour is free.

## 5. Test before you call it fixed

- **Every guard gets a case in `scripts/test-reply-guards.ts`**, including a
  sentence that must NOT trigger it. Run the whole file: zero ✗.
- **Re-run the chats that passed before, not only the one that failed.** In round
  3 a chat that had passed failed after an unrelated fix.
- **Test across kinds:** one men's barbershop, one beauty business, one clinic or
  trade, and one foreign-language chat, for any change to the base.
- **Know the sandbox.** In `/api/admin/agent/test` every booking succeeds (it is
  simulated). A test tool that books afterwards can collide with another test chat
  on the same hour. That is not an agent failure: check the real DB before you
  report "said booked when it was not".
- **Clean up.** Delete every test business, customer and conversation you made.
  Then run the DB check: zero test rows left.

## 6. Never

- Change DOMINANT's visible conversation without Yair's yes.
- Promote a trial guard to everyone without Yair's yes.
- Fix one chat by adding a sentence that names that chat's case to the base
  prompt.
- Report a fix as done without the before and after reply of a real chat.
