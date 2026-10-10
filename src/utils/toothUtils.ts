import { Session } from '../types';

export type ToothQuadrant = 'ur' | 'ul' | 'lr' | 'll';

export interface ToothInfo {
  compositeId: string; // e.g. "ur5" or "urA"
  quadrant: ToothQuadrant;
  number: number; // 1-8 for adult, 1-5 for pediatric
  isPediatric?: boolean;
  letter?: string; // "A", "B", "C", "D", "E"
}

export const QUADRANTS: { id: ToothQuadrant; title: string; pos: 'ur' | 'ul' | 'lr' | 'll' }[] = [
  { id: 'ur', title: 'علوي يمين', pos: 'ur' },
  { id: 'ul', title: 'علوي شمال', pos: 'ul' },
  { id: 'lr', title: 'سفلي يمين', pos: 'lr' },
  { id: 'll', title: 'سفلي شمال', pos: 'll' },
];

export const PEDIATRIC_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function getQuadrantTitle(quad: ToothQuadrant): string {
  switch (quad) {
    case 'ur': return 'الربع العلوي يمين';
    case 'ul': return 'الربع العلوي شمال';
    case 'lr': return 'الربع السفلي يمين';
    case 'll': return 'الربع السفلي شمال';
  }
}

export function parseCompositeToothId(compositeId: string): ToothInfo | null {
  if (typeof compositeId !== 'string' || !/^(ur|ul|lr|ll)([1-8]|[A-E])$/.test(compositeId)) return null;
  const quad = compositeId.substring(0, 2) as ToothQuadrant;
  const rest = compositeId.substring(2).toUpperCase();

  if (PEDIATRIC_LETTERS.includes(rest)) {
    const pIdx = PEDIATRIC_LETTERS.indexOf(rest) + 1;
    return {
      compositeId,
      quadrant: quad,
      number: pIdx,
      isPediatric: true,
      letter: rest
    };
  }

  const num = parseInt(rest, 10);
  if (isNaN(num) || num < 1 || num > 8) return null;
  return { compositeId, quadrant: quad, number: num, isPediatric: false };
}

export function getToothLabel(compositeId: string | null): string {
  if (!compositeId) return 'خدمة عامة';
  const parsed = parseCompositeToothId(compositeId);
  if (!parsed) return compositeId;
  if (parsed.isPediatric) {
    return `${getQuadrantTitle(parsed.quadrant)} - سن لبني (${parsed.letter})`;
  }
  return `${getQuadrantTitle(parsed.quadrant)} - سن ${parsed.number}`;
}

export function calculateToothBridgeRange(startCompositeId: string, endCompositeId: string): {
  teethIds: string[];
  count: number;
} {
  const startP = parseCompositeToothId(startCompositeId);
  const endP = parseCompositeToothId(endCompositeId);

  if (!startP || !endP || startP.quadrant !== endP.quadrant || startP.isPediatric !== endP.isPediatric) {
    return { teethIds: [startCompositeId], count: 1 };
  }

  const quad = startP.quadrant;
  const minNum = Math.min(startP.number, endP.number);
  const maxNum = Math.max(startP.number, endP.number);

  const teethIds: string[] = [];
  for (let n = minNum; n <= maxNum; n++) {
    teethIds.push(`${quad}${startP.isPediatric ? PEDIATRIC_LETTERS[n - 1] : n}`);
  }

  return { teethIds, count: teethIds.length };
}

export type ToothStatusType = 'normal' | 'filled' | 'crown' | 'endodontic' | 'extracted';

export interface ToothStatusResult {
  status: ToothStatusType;
  hasHistory: boolean;
  lastSessionType?: string;
  lastDate?: string;
  sessionCount: number;
}

export function sessionIncludesTooth(session: Session, compositeId: string): boolean {
  return session.tooth === compositeId || Boolean(session.teethIds?.includes(compositeId))
    || Boolean(session.services?.some(service => service.tooth === compositeId));
}

/** A mixed visit must not paint every tooth with the visit's combined procedures. */
export function getSessionToothProcedure(session: Session, compositeId: string): string {
  const items = session.services?.filter(service => service.tooth === compositeId);
  return items?.length ? items.map(item => item.name).join(' + ') : session.type;
}

export function getToothStatusForPatient(patientSessions: Session[], compositeId: string): ToothStatusResult {
  // Find all sessions involving this tooth composite ID
  const matchingSessions = patientSessions.filter(s => sessionIncludesTooth(s, compositeId));

  if (matchingSessions.length === 0) {
    return { status: 'normal', hasHistory: false, sessionCount: 0 };
  }

  // Sort sessions by date descending
  const sorted = [...matchingSessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastSession = sorted[0];

  let status: ToothStatusType = 'normal';
  const lastSessionType = getSessionToothProcedure(lastSession, compositeId);
  const typeLower = lastSessionType.toLowerCase();

  if (typeLower.includes('تركيب') || typeLower.includes('طربوش') || typeLower.includes('جسر') || typeLower.includes('زيركون') || typeLower.includes('pfm')) {
    status = 'crown';
  } else if (typeLower.includes('عصب') || typeLower.includes('جذور')) {
    status = 'endodontic';
  } else if (typeLower.includes('حشو')) {
    status = 'filled';
  } else if (typeLower.includes('خلع') || typeLower.includes('مفقود')) {
    status = 'extracted';
  }

  return {
    status,
    hasHistory: true,
    lastSessionType,
    lastDate: lastSession.date,
    sessionCount: matchingSessions.length
  };
}

