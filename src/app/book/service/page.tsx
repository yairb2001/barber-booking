"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  color: string | null;
  note: string | null;
  customPrice: number | null;
  customDuration: number | null;
};

type QuickSlot = {
  staffId: string;
  date: string;
  dayLabel: string;
  time: string;
  serviceId: string;
  price: number;
  duration: number;
};

type StaffInfo = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

function ChooseServicePageContent() {
  const searchParams = useSearchParams();
  const staffId = searchParams.get("staffId");
  const [services, setServices] = useState<Service[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!staffId) return;
    Promise.all([
      fetch(`/api/services?staffId=${staffId}`).then((r) => r.json()),
      fetch(`/api/quick-slots?staffId=${staffId}`).then((r) => r.json()),
      fetch("/api/staff").then((r) => r.json()),
    ]).then(([svc, slots, allStaff]) => {
      setServices(svc);
      setQuickSlots(slots);
      const found = allStaff.find((s: StaffInfo) => s.id === staffId);
      if (found) setStaffInfo(found);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [staffId]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/book" className="text-neutral-400 hover:text-white text-xl">
            ←
          </Link>
          <div className="flex items-center gap-2 flex-1">
            {staffInfo?.avatarUrl ? (
              <img src={staffInfo.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-neutral-700 flex items-center justify-center text-xs text-neutral-400">
                {staffInfo?.name?.[0]}
              </div>
            )}
            <h1 className="text-lg font-semibold">{staffInfo?.name || "בחירת שירות"}</h1>
          </div>
        </div>
        <div className="mt-1 flex gap-1">
          <div className="h-1 flex-1 bg-amber-500 rounded" />
          <div className="h-1 flex-1 bg-amber-500 rounded" />
          <div className="h-1 flex-1 bg-neutral-700 rounded" />
        </div>
      </div>

      {/* Quick Slots for this barber */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-4 pt-4">
          <div className="bg-neutral-900 rounded-xl p-3 border border-amber-500/20">
            <p className="text-xs text-amber-400 font-semibold mb-2">
              ⚡ תורים קרובים אצל {staffInfo?.name}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {quickSlots.map((slot, i) => (
                <Link
                  key={i}
                  href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                  className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 rounded-lg p-2 text-center transition"
                >
                  <div className="text-neutral-950 font-bold text-sm">{slot.time}</div>
                  <div className="text-amber-900 text-[11px]">{slot.dayLabel}</div>
                  <div className="text-amber-900/70 text-[10px]">{slot.duration} דק׳</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="px-4 pt-4 pb-1">
        <p className="text-xs text-neutral-500">או בחר שירות לראות כל השעות:</p>
      </div>

      {/* Services */}
      <div className="px-4 pb-4 space-y-3">
        {loading ? (
          [1, 2].map((i) => (
            <div key={i} className="h-24 bg-neutral-900 rounded-xl animate-pulse" />
          ))
        ) : (
          services.map((service) => {
            const price = service.customPrice ?? service.price;
            const duration = service.customDuration ?? service.durationMinutes;

            return (
              <Link
                key={service.id}
                href={`/book/time?staffId=${staffId}&serviceId=${service.id}`}
                className="block bg-neutral-900 hover:bg-neutral-800 transition rounded-xl border border-neutral-800 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: service.color || "#D4AF37" }}
                      />
                      <h3 className="font-semibold text-lg">{service.name}</h3>
                    </div>
                    {service.description && (
                      <p className="text-sm text-neutral-400 mt-1">{service.description}</p>
                    )}
                    {service.note && (
                      <p className="text-xs text-neutral-500 mt-1">{service.note}</p>
                    )}
                    <p className="text-sm text-neutral-500 mt-2">{duration} דקות</p>
                  </div>
                  <div className="text-amber-400 font-bold text-lg">₪{price}</div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function ChooseServicePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-neutral-400">טוען...</div>}>
      <ChooseServicePageContent />
    </Suspense>
  );
}
