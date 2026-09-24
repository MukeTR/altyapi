"use client";

import { useEffect, useState } from "react";

export function Countdown({
  endsAt,
  expiredBehavior,
  expiredMessage,
  labels,
}: {
  endsAt: string;
  expiredBehavior: "hide" | "show_message";
  expiredMessage: string;
  labels: { days: string; hours: string; minutes: string; seconds: string };
}) {
  const end = Date.parse(endsAt);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <div className="h-16" aria-hidden />;
  const left = Math.max(0, end - now);
  if (left === 0) return expiredBehavior === "show_message" && expiredMessage ? <p className="text-lg">{expiredMessage}</p> : null;
  const s = Math.floor(left / 1000);
  const parts = [
    [Math.floor(s / 86400), labels.days],
    [Math.floor((s % 86400) / 3600), labels.hours],
    [Math.floor((s % 3600) / 60), labels.minutes],
    [s % 60, labels.seconds],
  ] as const;
  return (
    <div className="flex justify-center gap-4" role="timer" aria-live="off">
      {parts.map(([v, l]) => (
        <div key={l} className="flex min-w-16 flex-col items-center rounded-theme bg-muted px-3 py-2">
          <span className="text-3xl font-bold tabular-nums">{String(v).padStart(2, "0")}</span>
          <span className="text-xs uppercase text-muted-fg">{l}</span>
        </div>
      ))}
    </div>
  );
}
