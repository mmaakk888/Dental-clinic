import test from 'node:test';
import assert from 'node:assert/strict';
import { getHomeClockDelay, getHomeClockDisplay } from './homeClock';

test('dashboard clock uses the local day before and after midnight including year rollover', () => {
  assert.equal(getHomeClockDisplay(new Date(2026, 11, 31, 23, 59)).day, '2026-12-31');
  assert.equal(getHomeClockDisplay(new Date(2027, 0, 1, 0, 0)).day, '2027-01-01');
  assert.equal(getHomeClockDisplay(new Date(2026, 9, 8, 0, 1)).day, '2026-10-08');
});

test('dashboard shows Arabic date and hour/minute without a per-second display', () => {
  const date = new Date(2026, 9, 8, 13, 7, 21, 123);
  const display = getHomeClockDisplay(date);
  assert.match(display.dateLabel, /٢٠٢٦/);
  assert.match(display.timeLabel, /٠١:٠٧/);
  assert.equal(display.timeLabel, getHomeClockDisplay(new Date(2026, 9, 8, 13, 7, 59)).timeLabel);
  assert.equal(new Date(display.instant).getTime(), date.getTime());
});

test('clock updates just after the next minute rather than every second', () => {
  assert.equal(getHomeClockDelay(new Date(2026, 9, 8, 13, 7, 0, 0)), 60_025);
  assert.equal(getHomeClockDelay(new Date(2026, 9, 8, 13, 7, 45, 500)), 14_525);
  assert.equal(getHomeClockDelay(new Date(2026, 9, 8, 13, 7, 59, 999)), 26);
});
