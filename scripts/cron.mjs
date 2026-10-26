// Own-server cron trigger: `node scripts/cron.mjs /api/cron/drip-queue`.
// Runs inside the app container (Coolify scheduled task), so it calls localhost.
const path = process.argv[2];
const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}${path}`, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  signal: AbortSignal.timeout(280_000),
});
console.log(path, res.status);
if (!res.ok) process.exit(1);
