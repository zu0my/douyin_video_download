import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(isoString: string): string {
  if (!isoString) return "";
  
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat(navigator.language, { numeric: "auto" });

  if (diffSeconds < 60) {
    return rtf.format(-diffSeconds, "second");
  }
  if (diffMinutes < 60) {
    return rtf.format(-diffMinutes, "minute");
  }
  if (diffHours < 24) {
    return rtf.format(-diffHours, "hour");
  }
  if (diffDays < 30) {
    return rtf.format(-diffDays, "day");
  }

  return new Intl.DateTimeFormat(navigator.language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
