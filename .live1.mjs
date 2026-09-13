import fs from "fs";
const B="https://barber-booking-indol.vercel.app"; const C=fs.readFileSync("/private/tmp/claude-501/-Users-yair9051-Documents-----/aed7d2b3-34da-484b-b8b5-2f86cf9dc4d1/scratchpad/admin_cookie.txt","utf8").trim();
const H={ "Cookie": `admin_session=${C}`, "Content-Type": "application/json" };
const j=async(p,o={})=>{ const r=await fetch(B+p,{...o,headers:{...H,...(o.headers||{})}}); let d=null; try{d=await r.json();}catch{} return {s:r.status,d}; };
const ok=(name,cond,extra="")=>console.log((cond?"✅":"❌"), name, extra);
const out={};
// 1 quick slots
let r=await j("/api/admin/quick-slots"); ok("admin/quick-slots", r.s===200&&Array.isArray(r.d)&&r.d.length>0, `${r.d?.length} slots, first: ${r.d?.[0]?.dayLabel} ${r.d?.[0]?.time} ${r.d?.[0]?.staffName}`);
const slot=r.d[0]; out.slot=slot;
// 2 admin slots
r=await j(`/api/admin/slots?staffId=${slot.staffId}&date=${slot.date}&serviceId=${slot.serviceId}`); ok("admin/slots", r.s===200&&r.d.slots?.includes(slot.time), `${r.d.slots?.length} free times that day`);
// 3 customers stats
r=await j("/api/admin/customers?stats=1&sort=last_visit&no_future=1&limit=5"); ok("customers?stats&sort&no_future", r.s===200&&r.d[0]&&"visits" in r.d[0]&&!r.d.some(x=>x.nextAppt), `top: ${r.d[0]?.name} · visits ${r.d[0]?.visits} · last ${r.d[0]?.lastVisit}`);
r=await j("/api/admin/customers?stats=1&no_shows=1&limit=5"); ok("customers?no_shows", r.s===200&&r.d.every(x=>x.noShows>0), `${r.d.length} rows`);
// 4 duplicates
r=await j("/api/admin/customers/duplicates"); ok("customers/duplicates", r.s===200&&Array.isArray(r.d), `${r.d.length} groups`);
// 5 create test customer with notes
r=await j("/api/admin/customers",{method:"POST",body:JSON.stringify({name:"בדיקה קלוד",phone:"0500000001",notes:"מכונה 2 בצדדים — לקוח בדיקה זמני"})});
let cust=r.d?.customer||r.d; ok("create test customer (notes column)", (r.s===201||r.s===409)&&!!cust?.id, `id ${cust?.id} notes=${cust?.notes?"yes":"no"}`); out.custId=cust.id;
r=await j("/api/admin/customers?q="+encodeURIComponent("לקוח בדיקה זמני")); ok("search by note text", r.s===200&&r.d.some(x=>x.id===cust.id));
// 6 detail insights
r=await j(`/api/admin/customers/${cust.id}`); ok("customer detail has insights", r.s===200&&r.d.insights&&typeof r.d.insights.visits==="number", `visits ${r.d.insights?.visits}`);
// 7 booking: duplicate guard
const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
r=await j(`/api/admin/slots?staffId=${slot.staffId}&date=${slot.date}&serviceId=${slot.serviceId}`); const times=r.d.slots;
const mk=(t,extra={})=>j("/api/admin/appointments",{method:"POST",body:JSON.stringify({staffId:slot.staffId,serviceId:slot.serviceId,date:slot.date,startTime:t,phone:"0500000001",customerName:"בדיקה קלוד",notifyCustomer:false,...extra})});
r=await mk(times[0]); ok("book test appt (no notify)", r.s===201, `${r.s} ${r.d?.id||r.d?.error}`); out.appt1=r.d?.id;
r=await mk(times[times.length-1]); ok("second booking → 409 duplicate", r.s===409&&r.d?.duplicate===true, r.d?.error);
r=await mk(times[times.length-1],{allowDuplicate:true}); ok("allowDuplicate → 201", r.s===201); out.appt2=r.d?.id;
// 8 recurring 3 weeks
r=await j("/api/admin/recurring",{method:"POST",body:JSON.stringify({customerId:cust.id,staffId:slot.staffId,serviceId:slot.serviceId,dayOfWeek:1,startTime:"11:00",frequencyWeeks:3,startDate:"2027-01-04",horizonWeeks:3})});
ok("recurring frequencyWeeks=3", r.s===200||r.s===201, JSON.stringify(r.d).slice(0,120)); out.recId=r.d?.id||r.d?.rule?.id||r.d?.recurring?.id;
// 9 analytics cancellations
const from=new Date(); from.setDate(1); const f=from.toISOString().slice(0,10); const to=new Date().toISOString().slice(0,10);
r=await j(`/api/admin/analytics?from=${f}&to=${to}`); ok("analytics.cancellations", r.s===200&&r.d.cancellations&&typeof r.d.cancellations.rate==="number", `rate ${r.d.cancellations?.rate}% late ${r.d.cancellations?.late} lost ₪${r.d.cancellations?.lateRevenue}`);
// 10 chats list fields
r=await j("/api/admin/chats"); ok("chats list has whatsappName/snoozedUntil keys", r.s===200&&Array.isArray(r.d)&&r.d.length>0&&("whatsappName" in r.d[0])&&("snoozedUntil" in r.d[0]), `${r.d?.length} chats`);
// 11 settings: read toggles
r=await j("/api/admin/business"); const st=r.d?.settings||{}; ok("settings apptConfirmations default off", st.apptConfirmations!==true, `apptConfirmations=${st.apptConfirmations} waitlistMode=${st.waitlistMode}`);
fs.writeFileSync(".live-state.json", JSON.stringify(out));
