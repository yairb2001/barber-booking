#!/usr/bin/env node
// Pre-push verification chain: lint -> build -> live smoke test (dev server + real browser).
// Run this after finishing a code change, BEFORE telling יאיר/המנכ"ל it's ready for push.
// Exit code 0 = all checks passed. Non-zero = something is broken, do not request push approval.
//
// Lint is a BASELINE gate, not a 100%-clean hard gate (decision: 2026-08-13) —
// there's real pre-existing lint debt across the repo that nobody asked us to
// clean up right now. This script fails ONLY on lint violations that are NOT
// already in .lint-baseline.json (i.e. genuinely new). Regenerate the baseline
// with `node scripts/verify-before-push.mjs --update-baseline` (only do this
// deliberately — e.g. after a real cleanup pass — never just to silence a
// failure).
// Build and the live smoke test remain full hard gates: zero deviation allowed.

import { spawn, spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(REPO_ROOT, ".lint-baseline.json");

const DEV_PORT = 3001;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const SMOKE_PATHS = [
  "/admin/login",
  "/dominant/book", // real business slug, exercises the public booking flow end to end
];

function step(name, fn) {
  process.stdout.write(`\n=== ${name} ===\n`);
  return fn();
}

function runOrThrow(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

/**
 * Run `next lint --format json` and return the parsed ESLint JSON report
 * (array of {filePath, messages: [...]}), regardless of exit code — a lint
 * failure is expected input here, not a script error.
 *
 * Written to a temp file via --output-file rather than captured from
 * stdout/stderr: piping ~1MB+ of JSON through spawnSync's stdio pipes proved
 * unreliable in testing (output silently truncated mid-string on some runs,
 * for reasons that didn't reproduce consistently — likely internal worker
 * buffering in `next lint`). A file write doesn't have that failure mode.
 */
function runLintJson() {
  const outFile = path.join(REPO_ROOT, ".lint-output.tmp.json");
  spawnSync("npx", ["next", "lint", "--format", "json", "--output-file", outFile], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  if (!existsSync(outFile)) {
    throw new Error("next lint did not produce an output file — lint may have crashed outright.");
  }
  try {
    const parsed = JSON.parse(readFileSync(outFile, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("lint output was not a JSON array");
    return parsed;
  } finally {
    try { unlinkSync(outFile); } catch { /* best effort cleanup */ }
  }
}

/** Normalize a lint report into a violation-key -> count multiset. Keyed by
 * relative path + rule + message (NOT line number, which drifts with
 * unrelated edits elsewhere in the same file and would cause false "new
 * violation" failures). */
function toViolationCounts(report) {
  const counts = {};
  for (const file of report) {
    const rel = path.relative(REPO_ROOT, file.filePath);
    for (const msg of file.messages || []) {
      const key = `${rel}::${msg.ruleId ?? "(no-rule)"}::${msg.message}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`Could not parse ${BASELINE_PATH} — treating baseline as empty.`);
    return {};
  }
}

/** Returns violations present in `current` beyond what `baseline` already
 * allows for that key (baseline count acts as an allowance, not just a set
 * membership check — so a NEW instance of an already-known rule+message
 * combo still gets caught). */
function diffAgainstBaseline(current, baseline) {
  const newOnes = [];
  for (const [key, count] of Object.entries(current)) {
    const allowed = baseline[key] || 0;
    if (count > allowed) {
      newOnes.push({ key, count, allowed });
    }
  }
  return newOnes;
}

async function runLintStep() {
  const report = runLintJson();
  const current = toViolationCounts(report);

  if (process.argv.includes("--update-baseline")) {
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    console.log(`Baseline updated: ${Object.keys(current).length} distinct violations, ${total} total, written to ${BASELINE_PATH}`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const newOnes = diffAgainstBaseline(current, baseline);
  if (newOnes.length) {
    console.error(`\nLINT: ${newOnes.length} NEW violation(s) not present in .lint-baseline.json:`);
    for (const v of newOnes) {
      console.error(`  [+${v.count - v.allowed}] ${v.key}`);
    }
    console.error(
      "\nThese are new — pre-existing baseline debt does not fail the check, but this does. Fix them, " +
      "or if a change is a deliberate baseline update (e.g. after a real cleanup pass), regenerate with " +
      "`node scripts/verify-before-push.mjs --update-baseline`."
    );
    return false;
  }
  const totalCurrent = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`Lint OK — ${totalCurrent} violation(s), all already in baseline (pre-existing debt, not blocking).`);
  return true;
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Fail fast with a clear message instead of a confusing EADDRINUSE deep inside
// `next dev` if a previous run's server is still hanging around on this port.
async function assertPortFree(port) {
  try {
    const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
    if (res) {
      console.error(
        `\nPort ${port} is already in use — a previous dev server may still be running.\n` +
        `Find it with: lsof -i :${port}\nKill it, then re-run this script.`
      );
      process.exit(1);
    }
  } catch {
    // Nothing listening — port is free, proceed.
  }
}

async function main() {
  let failed = false;

  await assertPortFree(DEV_PORT);

  const lintOk = await step("lint (baseline-aware)", () => runLintStep());
  if (!lintOk) failed = true;

  try {
    step("build", () => runOrThrow("npm run build"));
  } catch {
    console.error("BUILD FAILED — stopping here, no point smoke-testing a build that doesn't compile");
    process.exit(1);
  }

  if (failed) {
    console.error("\nLint failed but build passed — fix lint before requesting push approval.");
  }

  console.log("\n=== starting dev server ===");
  // `next build` and `next dev` don't share a .next cache cleanly back-to-back
  // in the same run (stale webpack chunk refs) — start dev from a clean cache.
  runOrThrow("rm -rf .next");
  const dev = spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true });

  try {
    const up = await waitForServer(DEV_URL);
    if (!up) {
      console.error("DEV SERVER DID NOT COME UP in time");
      process.exit(1);
    }

    console.log("\n=== browser smoke test (real chromium, headless) ===");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];

    page.on("pageerror", (err) => errors.push(`[console error] ${err.message}`));
    page.on("response", (res) => {
      if (res.status() >= 500) errors.push(`[${res.status()}] ${res.url()}`);
    });

    for (const path of SMOKE_PATHS) {
      const url = DEV_URL + path;
      console.log(`  checking ${url} ...`);
      const res = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 }).catch((e) => {
        errors.push(`[nav failed] ${url}: ${e.message}`);
        return null;
      });
      const bodyText = res ? await page.textContent("body").catch(() => "") : "";
      const match = (bodyText || "").match(/.{0,40}(application error|internal server error).{0,40}/i);
      if (match) {
        errors.push(`[error text on page] ${url} :: ...${match[0]}...`);
      }
    }

    await browser.close();

    if (errors.length) {
      console.error("\nSMOKE TEST FAILED:");
      errors.forEach((e) => console.error("  " + e));
      failed = true;
    } else {
      console.log("\nSmoke test passed — all pages loaded clean, no 5xx, no console errors.");
    }
  } finally {
    try {
      process.kill(-dev.pid);
    } catch {
      // already dead
    }
  }

  if (failed) {
    console.error("\n❌ verify-before-push FAILED — do not request push approval yet.");
    process.exit(1);
  }
  console.log("\n✅ verify-before-push PASSED (lint + build + live smoke test).");
}

main();
