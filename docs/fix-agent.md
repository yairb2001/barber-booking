# סוכן התיקונים (the fix agent)

A Claude Code run on Yair's Mac, every morning at 06:30 (scheduled task
`chator-fix-agent`). It turns the agent-improvement proposals Yair sent it into
prepared, tested fixes that wait for his approval in the CRM
(/admin/crm/improvements → "לאישור שלך"). Server side: `src/lib/agent/fix-queue.ts`.
Its hands: `scripts/fix-agent.ts` (run with `npx tsx --env-file=.env`).

Yair's rules, 15.10.2026:
- "כל הצעה מלבד להחליף מילה או 2 צריכה לעבור אצל סוכן ai פה במחשב שמבין שאסור לנפח פרומטים."
- "אסור שיגדל הרבה. אם נחוץ להגדיל את הפרומפט חייב אישור שלי והסבר למה."
- "שם אני אאשר דחיפה סופית": nothing goes live without his approval in the CRM.

## Every run, in this order

Read-only commands run from `~/Projects/chator-wt`. Never edit files there:
other sessions work in that checkout. Code work happens in a worktree per fix.

1. `scripts/fix-agent.ts queue` → the work, as JSON: each item has `status`,
   `yairWords` (his words: they win over the original proposal), `yairNotes`
   (his corrections after an earlier attempt), `evidence`, `previousFix`, and up
   to 3 `conversations` with full transcripts.
2. **status `publish`** (he approved a code fix): in its worktree
   (`fix.plan.branch`): `git fetch -q origin && git rebase origin/main`,
   `npx tsc --noEmit`, then `git push origin HEAD:main`. Poll
   https://barber-booking-indol.vercel.app/api/version until it shows the
   short sha, then `fix-agent.ts applied <id> <sha>`, remove the worktree and the
   branch. A conflict you can't resolve safely → `report` a `question`.
3. **status `revert`**: a fresh worktree from origin/main, `git revert <fix.plan.commit>`,
   tsc, push to main, poll, `fix-agent.ts reverted <id>`.
4. **status `queued`**: understand what Yair wants, read the conversations,
   then decide what kind of fix it is:
   - **a bug in code** (duplicate messages, wrong name, a slot that is not free,
     a false error): fix the code. Plan `{type:"code", branch, files}`.
   - **a fact of one shop** (price, hours, policy, a setup answer): plan
     `setup` (one answer), `faq` (replace the existing question when there is
     one: `replaceQuestion`), or `rules` with the shop's WHOLE rules text, merged
     and shortened. Do not write to the DB: the CRM applies it on approval.
   - **behavior for every shop**: change an existing section of
     `src/lib/agent/prompt-template.ts` (or the code that causes it). Replace,
     never append. Plan `code`.
   - **Chator's own support agent** (`source: "chator_question"`): plan
     `support_rules` with the WHOLE merged text (dedupe, shorten).
   - **not a real problem, or unclear**: `report` with a short Hebrew
     `question` and plan `{type:"none"}`. Don't guess.
5. **Prompt budget.** `fix-agent.ts prompt-size <businessId>` (or `support`)
   before; after = run it from the worktree for code, or compute the length
   difference of the replaced text for data plans. Fill `promptBefore` and
   `promptAfter`. If it grows by more than 100 characters, try again: merge,
   shorten, replace. Only if it truly must grow: `growthReason`, one or two
   Hebrew sentences why. Yair must tick "אני מאשר להגדיל" for it.
6. **Test on the real conversation.** The local Anthropic key does not work;
   test through the server with `--via-api` (sandbox: nothing is sent, nothing
   is saved, usage is tagged as tests, not on the shop):
   - data and prompt-text plans: `scripts/replay-local.ts --via-api --template --setup <file>`
     or `scripts/replay-real.ts --variants live,candidate`, always with `--ids`
     of the conversations (see each script's header);
   - code: push the fix branch (`git push origin fix/imp-<id8>`, never to main)
     and replay against its Vercel preview with `REPLAY_BASE=<preview url>` if one
     exists; otherwise a targeted script check plus tsc, and say so in `tested`.
   At most 3 conversations per fix. Put the wrong reply in `before`, the new
   one in `after`, and what you ran in `tested`.
7. Write the fix JSON to a temp file and `fix-agent.ts report <id> <file>`.
8. Last: `fix-agent.ts notify` (one push to Yair when something waits for him).

## The fix JSON

```json
{
  "summary": "משפט אחד: מה השתנה",
  "appliesTo": "כל העסקים" ,
  "before": "התשובה שהסוכן נתן",
  "after": "התשובה אחרי התיקון",
  "tested": "מה הורץ",
  "promptBefore": 13911,
  "promptAfter": 13890,
  "growthReason": "רק אם גדל ביותר מ-100 תווים",
  "plan": { "type": "code", "branch": "fix/imp-1a2b3c4d", "files": ["src/lib/agent/customer-agent.ts"] }
}
```
`appliesTo`: "כל העסקים" or "רק <שם העסק>". Data plans:
`{type:"setup", businessId, key, value}`, `{type:"rules", businessId, text}`,
`{type:"faq", businessId, question, answer, replaceQuestion?}`,
`{type:"support_rules", text}`. A question: `{"question": "...", "plan": {"type": "none"}}`.

## Worktree per fix

```
id8=<first 8 chars of the improvement id>
git -C ~/Projects/chator-wt fetch -q origin
git -C ~/Projects/chator-wt worktree add ~/Projects/chator-fixes/$id8 -b fix/imp-$id8 origin/main
ln -s ~/Projects/chator-wt/node_modules ~/Projects/chator-fixes/$id8/node_modules
cp ~/Projects/chator-wt/.env ~/Projects/chator-fixes/$id8/.env
```
Never change `prisma/schema.prisma` (node_modules is shared). Commit in the
worktree with a clear message ending with the Co-Authored-By line.

## Never

- Push to main anything that is not in status `publish` or `revert`.
- Edit the shared checkout `~/Projects/chator-wt`.
- Send anything to a customer, an owner or a lead; mark a shop paid.
- Grow a prompt without `growthReason`.
- English words or long dashes in anything Yair reads (summary, before/after,
  tested, question, growthReason). He reads Hebrew only.
