import type { Lab, LabCase, LabService, Patient } from '../types';
import { cloneLab, createLabPricingDraft, snapshotLab, validateLabPricingDraft } from './labPricing';
import { normalizeServiceName } from './serviceCatalog';

type LabMetadataDraft = Omit<Lab, 'id'> & { id?: string };

function cloneWorkflowSnapshot<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const copy: any = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  Object.entries(value).forEach(([key, entry]) => Object.defineProperty(copy, key, {
    value: cloneWorkflowSnapshot(entry, seen), writable: true, configurable: true, enumerable: true,
  }));
  return copy;
}

/** A stale workflow card must never overwrite newer financial or reservation data. */
export function mergeLabCaseWorkflowUpdate(current: LabCase, incoming: LabCase): LabCase {
  if (!current || !incoming || current.id !== incoming.id) {
    throw new Error('معرّف حالة المعمل لا يطابق الحالة المطلوب تحديثها.');
  }
  if (current.creationFingerprint && current.linkedSessionId !== incoming.linkedSessionId) {
    throw new Error('هذه التركيبة مرتبطة تلقائيًا بجلسة المريض؛ لا يمكن فصلها أو نقلها إلى جلسة أخرى.');
  }
  return { ...cloneWorkflowSnapshot(current), status: incoming.status, linkedSessionId: incoming.linkedSessionId };
}

/** Run against the locked, freshly read domain, not a card's stale props. */
export function assertLabCaseSessionLink(cases: readonly LabCase[], patients: readonly Patient[], candidate: Pick<LabCase, 'id' | 'patientId' | 'linkedSessionId'>): void {
  const patient = patients.find(item => item.id === candidate.patientId);
  if (!patient) throw new Error('ملف المريض المرتبط بحالة المعمل لم يعد موجودًا.');
  if (!candidate.linkedSessionId) return;
  if (!patient.sessions.some(session => session.id === candidate.linkedSessionId)) {
    throw new Error('الخدمة المحددة لم تعد موجودة في ملف المريض. اختر الخدمة مرة أخرى.');
  }
  if (cases.some(item => item.id !== candidate.id && item.patientId === candidate.patientId && item.linkedSessionId === candidate.linkedSessionId)) {
    throw new Error('الخدمة مرتبطة بالفعل بحالة معمل أخرى. راجع الحالة الموجودة قبل الحفظ.');
  }
}

const conflictMessage = 'بيانات هذا المعمل تغيّرت منذ فتح التعديل. أعد تحميل بياناته قبل الحفظ.';
const missingMessage = 'المعمل غير موجود الآن. أعد تحميل قائمة المعامل.';
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function validateText(value: unknown, label: string, limit: number, required = false, multiline = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new Error(`اكتب ${label} بصورة صحيحة.`);
  const forbidden = multiline ? /[\p{Cc}\u2028\u2029]/u.test(value.replace(/[\r\n]/g, '')) : /[\p{Cc}\u2028\u2029]/u.test(value);
  if (forbidden) throw new Error(`${label} يحتوي على رموز تحكم غير مسموح بها.`);
  const trimmed = value.trim();
  if (required && (!trimmed || !normalizeServiceName(trimmed))) throw new Error(`${label} مطلوب.`);
  if (Array.from(trimmed).length > limit) throw new Error(`${label} يجب ألا يتجاوز ${limit} حرفًا.`);
  return trimmed;
}

function selectedLab(latest: readonly Lab[], labId: string, baseline: Lab): Lab {
  if (!Array.isArray(latest)) throw new Error('قائمة المعامل غير صحيحة.');
  const matches = latest.filter(lab => lab?.id === labId);
  if (matches.length !== 1) throw new Error(matches.length ? 'معرّف المعمل مكرر. أعد تحميل قائمة المعامل.' : missingMessage);
  const current = matches[0];
  if (!baseline || baseline.id !== labId || snapshotLab(current) !== snapshotLab(baseline)) throw new Error(conflictMessage);
  return current;
}

/** Prepare a single supplier's costs without repricing historical cases or patient selling prices. */
export function prepareLabPricingSave(latest: Lab[], labId: string, services: LabService[], baseline: Lab): Lab[] {
  const current = selectedLab(latest, labId, baseline);
  if (!Array.isArray(services)) throw new Error('قائمة خدمات المعمل غير صحيحة.');
  const validation = validateLabPricingDraft(createLabPricingDraft({ ...current, services }), current.services);
  if (!validation.valid) throw new Error(Object.values(validation.errors)[0] || 'راجع بيانات خدمات وأسعار المعمل قبل الحفظ.');
  return latest.map(lab => {
    const copy = cloneLab(lab);
    if (lab.id === labId) copy.services = validation.services;
    return copy;
  });
}

/** Metadata editing never replaces the canonical services with a stale form's copy. */
export function prepareLabMetadataSave(latest: Lab[], draft: LabMetadataDraft, baseline?: Lab, newId?: string): Lab[] {
  if (!Array.isArray(latest) || !isRecord(draft)) throw new Error('بيانات المعمل غير صحيحة.');
  const editing = draft.id !== undefined;
  const current = editing ? selectedLab(latest, draft.id as string, baseline as Lab) : undefined;
  const name = validateText(draft.name, 'اسم المعمل', 100, true)!;
  const phone = validateText(draft.phone, 'رقم الهاتف', 40);
  const address = validateText(draft.address, 'العنوان', 200);
  const notes = validateText(draft.notes, 'الملاحظات', 1000, false, true);
  if (latest.some(lab => lab.id !== current?.id && normalizeServiceName(lab.name) === normalizeServiceName(name))) {
    throw new Error('اسم المعمل موجود بالفعل. اختر اسمًا مختلفًا.');
  }
  const metadata = { name, phone, address, notes };
  if (current) {
    return latest.map(lab => lab.id === current.id ? { ...cloneLab(lab), ...metadata } : cloneLab(lab));
  }
  if (typeof newId !== 'string' || !newId.trim() || /[\p{Cc}\u2028\u2029]/u.test(newId) || newId !== newId.trim()) {
    throw new Error('معرّف المعمل الجديد غير صحيح.');
  }
  if (latest.some(lab => lab.id === newId)) throw new Error('معرّف المعمل الجديد مستخدم بالفعل.');
  // Do not seed invented costs or accept catalog data supplied by the metadata form.
  return [...latest.map(cloneLab), { id: newId, ...metadata, services: [] }];
}
