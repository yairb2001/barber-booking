#!/usr/bin/env node
// Pre-push verification chain: lint -> build -> live smoke test (dev server + real browser).
// Run this after finishing a code change, BEFORE telling יאיר/המנכ"ל it's ready for push.
// Exit code 0 = all checks passed. Non-zero = something is broken, do not request push approval.

import { spawn, execSync } from "node:child_process";
import { chromium } from "playwright";

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

  try {
    step("lint", () => runOrThrow("npm run lint"));
  } catch {
    console.error("LINT FAILED");
    failed = true;
  }

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
