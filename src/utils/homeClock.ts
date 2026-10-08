const dateFormatter = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

export function getHomeClockDisplay(now: Date) {
  return {
    day: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    dateLabel: dateFormatter.format(now),
    timeLabel: timeFormatter.format(now),
    instant: now.toISOString(),
  };
}

/** Schedule just after the next minute; avoid a ticking clock rerendering the page every second. */
export function getHomeClockDelay(now: Date): number {
  return 60_000 - now.getSeconds() * 1000 - now.getMilliseconds() + 25;
}
