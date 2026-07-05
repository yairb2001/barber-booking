import { readFileSync } from "fs";

// read key from pulled env
const envTxt = readFileSync(".vercel/.env.pulled", "utf8");
const m = envTxt.match(/OPENAI_API_KEY="?([^"\n]+)"?/);
const apiKey = m ? m[1] : null;
console.log("key present:", !!apiKey, "prefix:", apiKey?.slice(0, 7), "len:", apiKey?.length);

const URL = "https://api.openai.com/v1/chat/completions";

// 1) plain call, no tools
async function plain() {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 100,
      messages: [{ role: "system", content: "You are a barber assistant." }, { role: "user", content: "היי, יש תור מחר?" }],
    }),
  });
  console.log("\n[PLAIN] status:", res.status);
  const body = await res.text();
  console.log("[PLAIN] body:", body.slice(0, 600));
}

plain().catch(e => console.error("PLAIN threw:", e));
