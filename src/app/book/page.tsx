"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type QuickSlot = {
  staffId: string;
  staffName: string;
  date: string;
  dayLabel: string;
  time: string;
  serviceId: string;
  serviceName: string;
  price: number;
  duration: number;
};

type Staff = {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  isAvailable: boolean;
};

export default function ChooseBarberPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/staff").then((r) => r.json()),
      fetch("/api/quick-slots").then((r) => r.json()),
    ])
      .then(([staffData, slots]) => {
        setStaff(staffData);
        setQuickSlots(slots);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Find nearest slot per barber
  const getBarberSlot = (staffId: string) =>
    quickSlots.find((s) => s.staffId === staffId);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-neutral-400 hover:text-white text-xl">
            ←
          </Link>
          <h1 className="text-lg font-semibold">בחירת ספר</h1>
        </div>
        <div className="mt-1 flex gap-1">
          <div className="h-1 flex-1 bg-amber-500 rounded" />
          <div className="h-1 flex-1 bg-neutral-700 rounded" />
          <div className="h-1 flex-1 bg-neutral-700 rounded" />
        </div>
      </div>

      {/* Quick nearest slots - any barber */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-4 pt-4">
          <div className="bg-neutral-900/80 rounded-xl p-3 border border-amber-500/30">
            <h2 className="text-sm font-semibold text-amber-400 mb-2">
              התור הכי קרוב (לא משנה הספר)
            </h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {quickSlots.map((slot, i) => (
                <Link
                  key={i}
                  href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                  className="min-w-[110px] bg-neutral-800 hover:bg-neutral-700 transition rounded-lg p-2 border border-neutral-700/50 flex-shrink-0"
                >
                  <div className="text-amber-400 font-bold text-sm">
                    {slot.time}
                  </div>
                  <div className="text-[11px] text-neutral-300">
                    {slot.dayLabel}
                  </div>
                  <div className="text-[11px] text-neutral-400 truncate">
                    {slot.staffName}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Staff Grid */}
      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-48 bg-neutral-900 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {staff.map((member) => {
              const nearestSlot = getBarberSlot(member.id);

              return (
                <div
                  key={member.id}
                  className="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden"
                >
                  {/* Main card - navigates to service selection */}
                  <Link
                    href={`/book/service?staffId=${member.id}`}
                    className="block hover:bg-neutral-800 transition"
                  >
                    <div className="h-24 bg-gradient-to-b from-neutral-800 to-neutral-900 flex items-center justify-center">
                      {member.avatarUrl ? (
                        <img
                          src={member.avatarUrl}
                          alt={member.name}
                          className="w-14 h-14 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-neutral-700 flex items-center justify-center text-xl text-neutral-400">
                          {member.name[0]}
                        </div>
                      )}
                    </div>
                    <div className="px-2 pt-2 pb-1 text-center">
                      <div className="font-semibold text-sm">{member.name}</div>
                      {member.nickname && (
                        <div className="text-[10px] text-neutral-500">
                          {member.nickname}
                        </div>
                      )}
                    </div>
                  </Link>

                  <div className="h-2" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
