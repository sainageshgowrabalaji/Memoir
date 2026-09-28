const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const date = new Date(ts);
  if (days < 7) return date.toLocaleDateString([], { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function longDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function ago(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** Groups a newest-first list into sections by day, for SectionList. */
export function byDay<T extends { createdAt: number }>(items: T[], now = Date.now()) {
  const sections: { title: string; data: T[] }[] = [];
  for (const item of items) {
    const title = dayLabel(item.createdAt, now);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(item);
    else sections.push({ title, data: [item] });
  }
  return sections;
}

/** A time coming up, in words: "today at 8:00 PM", "tomorrow at 8:00 PM", "Saturday at 10:00 AM". */
export function soonLabel(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
  const time = timeLabel(ts);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const date = new Date(ts);
  if (days < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}
