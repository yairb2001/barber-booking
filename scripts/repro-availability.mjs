import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const tm=t=>{const[h,m]=t.split(":").map(Number);return h*60+m;};
const mt=x=>`${Math.floor(x/60).toString().padStart(2,"0")}:${(x%60).toString().padStart(2,"0")}`;
const gen=(sl,br,d,bk)=>{const o=[];for(const s of sl){let c=tm(s.start);const e=tm(s.end);while(c+d<=e){const ib=(br||[]).some(b=>c<tm(b.end)&&c+d>tm(b.start));const bo=bk.some(b=>c<tm(b.endTime)&&c+d>tm(b.startTime));if(!ib&&!bo)o.push(mt(c));c+=d;}}return o;};
const dow=iso=>new Date(iso+"T00:00:00.000Z").getUTCDay();
const add=(iso,n)=>{const d=new Date(iso+"T00:00:00.000Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};

const biz = await prisma.business.findFirst({ where: { name: "dominant" }, select: { id: true, bookingHorizonDays: true } });
const b = await prisma.staff.findFirst({ where: { businessId: biz.id, name: { contains: "בוחבוט" } }, select: { id: true, name: true, settings: true } });

async function dayAvail(date, serviceId, mode) {
  const cfg = b.settings ? JSON.parse(b.settings) : {};
  const horizon = cfg.bookingHorizonDays > 0 ? cfg.bookingHorizonDays : (biz.bookingHorizonDays ?? 30);
  const today = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jerusalem"});
  if (date > add(today, Math.max(0,horizon-1))) return { skipped:"horizon", slots:[] };
  const reqService = serviceId ? await prisma.service.findUnique({ where:{id:serviceId}, select:{name:true,durationMinutes:true} }) : null;
  let duration = 30;
  if (serviceId) {
    const ss = await prisma.staffService.findUnique({ where:{staffId_serviceId:{staffId:b.id,serviceId}}, include:{service:true} });
    if (ss) duration = ss.customDuration ?? ss.service.durationMinutes;
    else if (mode==="old") {
      if (reqService) { const alt=(await prisma.staffService.findFirst({where:{staffId:b.id,service:{name:reqService.name}},include:{service:true}}))??(await prisma.staffService.findFirst({where:{staffId:b.id,service:{durationMinutes:reqService.durationMinutes}},include:{service:true}})); if(!alt) return {skipped:"SKIP(old:no-alt)",slots:[]}; duration=alt.customDuration??alt.service.durationMinutes; }
      else return {skipped:"SKIP(old:unknown-id)",slots:[]};
    } else {
      const alt = reqService ? ((await prisma.staffService.findFirst({where:{staffId:b.id,service:{name:reqService.name}},include:{service:true}}))??(await prisma.staffService.findFirst({where:{staffId:b.id,service:{durationMinutes:reqService.durationMinutes}},include:{service:true}}))) : null;
      if (alt) duration=alt.customDuration??alt.service.durationMinutes;
      else if (reqService) duration=reqService.durationMinutes;
      else { const fs=await prisma.staffService.findFirst({where:{staffId:b.id},include:{service:true},orderBy:{service:{durationMinutes:"asc"}}}); duration=fs?.customDuration??fs?.service.durationMinutes??30; }
    }
  } else { const fs=await prisma.staffService.findFirst({where:{staffId:b.id},include:{service:true},orderBy:{service:{durationMinutes:"asc"}}}); duration=fs?.customDuration??fs?.service.durationMinutes??30; }
  const dObj=new Date(date+"T00:00:00.000Z");
  const ov=await prisma.staffScheduleOverride.findUnique({where:{staffId_date:{staffId:b.id,date:dObj}}});
  if (ov&&!ov.isWorking) return {skipped:"dayoff",slots:[]};
  let sl=[],br=null;
  if (ov?.isWorking&&ov.slots){sl=JSON.parse(ov.slots);br=ov.breaks?JSON.parse(ov.breaks):null;}
  else {const sc=await prisma.staffSchedule.findUnique({where:{staffId_dayOfWeek:{staffId:b.id,dayOfWeek:dow(date)}}});if(!sc?.isWorking)return{skipped:"dayoff",slots:[]};sl=JSON.parse(sc.slots);br=sc.breaks?JSON.parse(sc.breaks):null;}
  const bk=await prisma.appointment.findMany({where:{staffId:b.id,date:{gte:dObj,lt:new Date(dObj.getTime()+86400000)},status:{in:["pending","confirmed"]}},select:{startTime:true,endTime:true}});
  return {duration, slots:gen(sl,br,duration,bk)};
}

const BAD="00000000-0000-0000-0000-000000000000";
const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jerusalem"});
console.log("today:",today,"| simulating find_next_available for",b.name,"(scan 30 days)\n");
for (const [label,sid,mode] of [
  ["bad/unknown serviceId — OLD code (the bug)", BAD, "old"],
  ["bad/unknown serviceId — NEW code (the fix)", BAD, "new"],
]) {
  let found=null;
  for (let d=0; d<30; d++){const ds=add(today,d);const r=await dayAvail(ds,sid,mode);if(r.slots.length){found={ds,...r};break;}}
  console.log(`${label}:`);
  console.log(found ? `  → FIRST FREE: ${found.ds} (dur ${found.duration}min) slots: ${found.slots.slice(0,9).join(", ")}\n` : `  → EMPTY across 30 days (reproduces "אין מקום")\n`);
}
await prisma.$disconnect();
