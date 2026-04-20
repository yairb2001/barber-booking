"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDayName(date: Date): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
}

function getDateLabel(date: Date, today: Date): string {
  const diff = Math.floor(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return `יום ${getDayName(date)}`;
}

export default function ChooseTimePage() {
  const searchParams = useSearchParams();
  const staffId = searchParams.get("staffId");
  const serviceId = searchParams.get("serviceId");

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<{ date: string; label: string; dayName: string; dayNum: number }[]>([]);

  // Generate next 14 days
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      nextDates.push({
        date: formatDate(d),
        label: getDateLabel(d, today),
        dayName: getDayName(d),
        dayNum: d.getDate(),
      });
    }
    setDates(nextDates);
    setSelectedDate(formatDate(today));
  }, []);

  // Fetch slots when date changes
  useEffect(() => {
    if (!staffId || !serviceId || !selectedDate) return;
    setLoading(true);
    fetch(
      `/api/slots?staffId=${staffId}&serviceId=${serviceId}&date=${selectedDate}`
    )
      .then((res) => res.json())
      .then((data) => {
        setSlots(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [staffId, serviceId, selectedDate]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/book/service?staffId=${staffId}`}
            className="text-neutral-400 hover:text-white text-xl"
          >
            ←
          </Link>
          <h1 className="text-lg font-semibold">בחירת תאריך ושעה</h1>
        </div>
        <div className="mt-1 flex gap-1">
          <div className="h-1 flex-1 bg-amber-500 rounded" />
          <div className="h-1 flex-1 bg-amber-500 rounded" />
          <div className="h-1 flex-1 bg-amber-500 rounded" />
        </div>
      </div>

      {/* Date Selector */}
      <div className="px-4 pt-4">
        <div className="flex gap-2 overflow-x-auto pb-3">
          {dates.map((d) => (
            <button
              key={d.date}
              onClick={() => setSelectedDate(d.date)}
              className={`flex-shrink-0 w-16 py-2 rounded-xl text-center border transition ${
                selectedDate === d.date
                  ? "bg-amber-500 border-amber-500 text-neutral-950"
                  : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-600"
              }`}
            >
              <div className="text-xs">{d.label.length <= 4 ? d.label : d.dayName}</div>
              <div className="text-lg font-bold">{d.dayNum}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Time Slots */}
      <div className="px-4 pt-2">
        <h2 className="text-sm text-neutral-400 mb-3">
          {dates.find((d) => d.date === selectedDate)?.label || ""}
        </h2>

        {loading ? (
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="h-10 bg-neutral-900 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : slots.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {slots.map((time) => (
              <Link
                key={time}
                href={`/book/confirm?staffId=${staffId}&serviceId=${serviceId}&date=${selectedDate}&time=${time}`}
                className="bg-neutral-900 hover:bg-amber-500 hover:text-neutral-950 transition text-center py-2.5 rounded-lg border border-neutral-800 hover:border-amber-500 font-medium"
              >
                {time}
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-neutral-500">
            <p className="text-lg">אין תורים פנויים</p>
            <p className="text-sm mt-1">נסה תאריך אחר</p>
          </div>
        )}
      </div>
    </div>
  );
}
