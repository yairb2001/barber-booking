import fs from "fs";
for (const l of fs.readFileSync(".env","utf8").split("\n")) { const m=l.match(/^([A-Z_]+)="?([^"]*)"?$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2]; }
const { SignJWT } = await import("jose"); const k=new TextEncoder().encode(process.env.AUTH_SECRET);
const B="https://barber-booking-indol.vercel.app"; const C=fs.readFileSync("/private/tmp/claude-501/-Users-yair9051-Documents-----/aed7d2b3-34da-484b-b8b5-2f86cf9dc4d1/scratchpad/admin_cookie.txt","utf8").trim();
const st=JSON.parse(fs.readFileSync(".live-state.json","utf8"));
const H={ "Cookie": `admin_session=${C}`, "Content-Type": "application/json" };
const j=async(p,o={},auth=true)=>{ const r=await fetch(B+p,{...o,headers:{...(auth?H:{"Content-Type":"application/json"}),...(o.headers||{})}}); let d=null; try{d=await r.json();}catch{} return {s:r.status,d}; };
const ok=(name,cond,extra="")=>console.log((cond?"✅":"❌"), name, extra);
const b="c8e1ac89-32d1-4e00-b493-2e95aef4d8f2"; const phone="972500000001";
// A) personal link → auto-token
const link = await new SignJWT({ phone, businessId: b, type: "customer_link" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(k);
let r=await j("/api/otp/auto-token",{method:"POST",body:JSON.stringify({link})},false); ok("auto-token via personal link", r.s===200&&r.d.token, `phone ${r.d?.phone} name ${r.d?.name}`);
const otp=r.d.token;
// B) customer move: appt1 → another free slot (same day or later)
r=await j(`/api/my-appointments?phone=0500000001&token=${encodeURIComponent(otp)}`,{},false); ok("my-appointments list", r.s===200&&r.d.upcoming?.length>=1, `${r.d.upcoming?.length} upcoming`);
const a1=r.d.upcoming.find(x=>x.id===st.appt1)||r.d.upcoming[0];
// find a day with a free slot in the next 10 days for the same staff/service
let target=null;
for (let i=1;i<=10&&!target;i++){ const d=new Date(Date.now()+i*86400000).toISOString().slice(0,10); const s=await j(`/api/slots?staffId=${a1.staff.id}&serviceId=${a1.service.id}&date=${d}`,{},false); const free=(s.d?.slots||[]).filter(t=>!(d===a1.date.slice(0,10)&&t===a1.startTime)); if(free.length) target={date:d,time:free[0]}; }
ok("found a free target slot", !!target, JSON.stringify(target));
r=await j("/api/my-appointments/move",{method:"POST",body:JSON.stringify({appointmentId:a1.id,phone:"0500000001",token:otp,date:target.date,startTime:target.time})},false);
ok("move appointment", r.s===200&&r.d.ok, JSON.stringify(r.d));
r=await j(`/api/admin/appointments/${a1.id}`); ok("moved in DB", r.s===200&&String(r.d.date).slice(0,10)===target.date&&r.d.startTime===target.time, `${String(r.d?.date).slice(0,10)} ${r.d?.startTime} status ${r.d?.status}`);
// C) confirmations: turn on, simulate "1" via webhook, check confirmedAt, turn off
r=await j("/api/admin/business",{method:"PATCH",body:JSON.stringify({settingsPatch:{apptConfirmations:true}})}); ok("enable apptConfirmations", r.s===200);
r=await j("/api/webhook/whatsapp",{method:"POST",body:JSON.stringify({typeWebhook:"incomingMessageReceived",idMessage:"test-"+Date.now(),senderData:{chatId:phone+"@c.us",senderName:"בדיקה קלוד"},messageData:{typeMessage:"textMessage",textMessageData:{textMessage:"1"}},instanceData:{}})},false);
ok("webhook '1' handled by confirm router", r.s===200&&r.d?.handled==="confirm_reply", JSON.stringify(r.d));
r=await j(`/api/admin/appointments/${a1.id}`); ok("confirmedAt stamped", !!r.d?.confirmedAt, String(r.d?.confirmedAt));
r=await j("/api/admin/business",{method:"PATCH",body:JSON.stringify({settingsPatch:{apptConfirmations:false}})}); ok("disable apptConfirmations (back to default)", r.s===200);
// D) chat snooze on the test conversation
r=await j("/api/admin/chats"); const conv=r.d.find(c=>c.phone===phone); ok("test conversation exists in inbox", !!conv, conv?.id);
if(conv){ r=await j(`/api/admin/chats/${conv.id}/mark-handled`,{method:"POST",body:JSON.stringify({snoozeHours:1})}); ok("snooze 1h", r.s===200&&r.d.snoozedUntil, String(r.d?.snoozedUntil)); }
// E) waitlist mode round trip
r=await j("/api/admin/business",{method:"PATCH",body:JSON.stringify({settingsPatch:{waitlistMode:"auto"}})}); let g=await j("/api/admin/business"); ok("waitlistMode=auto saved", g.d?.settings?.waitlistMode==="auto");
r=await j("/api/admin/business",{method:"PATCH",body:JSON.stringify({settingsPatch:{waitlistMode:"notify"}})}); g=await j("/api/admin/business"); ok("waitlistMode back to notify", g.d?.settings?.waitlistMode==="notify");
fs.writeFileSync(".live-state.json", JSON.stringify({...st, convId: conv?.id}));
