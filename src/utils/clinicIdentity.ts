import type { ThemeSettings } from '../types';
import { DEFAULT_THEME } from '../data/initialData';

export { DEFAULT_THEME };
export type ThemeColors = Pick<ThemeSettings, 'primary' | 'secondary' | 'accent' | 'background'>;
export interface ColorPreset extends ThemeColors { id: string; name: string; description: string }
export interface GoogleFontSettings { name: string; fontFamily: string; customFontUrl: string }
export interface FontChoice extends GoogleFontSettings { id: string; label: string; description: string }
export interface IdentityDraft { clinicName: string; clinicLogo: string | null; theme: ThemeSettings }
export interface NameValidation { valid: boolean; value: string; error: string | null }
export interface MetadataValidation { valid: boolean; error: string | null }

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { id: 'royal-blue', name: 'أزرق ملكي', description: 'أزرق واضح مع لمسة دافئة', primary: '#2563eb', secondary: '#1d4ed8', accent: '#f59e0b', background: '#f8fafc' },
  { id: 'medical-emerald', name: 'زمردي طبي', description: 'ألوان خضراء هادئة', primary: '#059669', secondary: '#047857', accent: '#10b981', background: '#f0fdf4' },
  { id: 'purple', name: 'بنفسجي', description: 'بنفسجي مع تمييز ذهبي', primary: '#7c3aed', secondary: '#6d28d9', accent: '#f59e0b', background: '#faf5ff' },
  { id: 'slate', name: 'رمادي كلاسيكي', description: 'رمادي متزن مع تمييز أزرق', primary: '#334155', secondary: '#1e293b', accent: '#0284c7', background: '#f8fafc' },
  { id: 'rose', name: 'وردي هادئ', description: 'وردي مع خلفية خفيفة', primary: '#e11d48', secondary: '#be123c', accent: '#fb7185', background: '#fff1f2' },
  { id: 'teal', name: 'فيروزي حديث', description: 'فيروزي وخلفية مريحة', primary: '#0d9488', secondary: '#0f766e', accent: '#f59e0b', background: '#f0fdfa' },
];

const knownFonts = [
  { id: 'cairo', name: 'Cairo', label: 'القاهرة', description: 'عصري وواضح للواجهات' },
  { id: 'tajawal', name: 'Tajawal', label: 'تجوال', description: 'ناعم ومتناسق' },
  { id: 'alexandria', name: 'Alexandria', label: 'الإسكندرية', description: 'دقيق وواضح' },
  { id: 'ibm-plex', name: 'IBM Plex Sans Arabic', label: 'آي بي إم', description: 'رسمي ومنظم' },
  { id: 'readex', name: 'Readex Pro', label: 'ريديكس برو', description: 'خفيف ومناسب للواجهات' },
  { id: 'amiri', name: 'Amiri', label: 'الأميري', description: 'نسخي كلاسيكي' },
  { id: 'changa', name: 'Changa', label: 'تشانغا', description: 'عريض وواضح' },
  { id: 'reem-kufi', name: 'Reem Kufi', label: 'ريم الكوفي', description: 'كوفي مميز' },
];

// Validates a family name only, not a URL, CSS declaration, or whether a remote family exists.
export function buildGoogleFont(input: unknown): GoogleFontSettings | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().replace(/ +/g, ' ');
  if (normalized.length < 3 || normalized.length > 60 || !/^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/.test(normalized)) return null;
  const name = knownFonts.find(font => font.name.toLowerCase() === normalized.toLowerCase())?.name ?? normalized;
  const fallback = name === 'Amiri' ? 'serif' : 'sans-serif';
  return {
    name,
    fontFamily: `'${name}', ${fallback}`,
    // Known families include static-font compatible regular/bold weights; no arbitrary URL is accepted.
    customFontUrl: `https://fonts.googleapis.com/css2?family=${name.split(' ').map(encodeURIComponent).join('+')}:wght@400;700&display=swap`,
  };
}

export const FONT_CHOICES: readonly FontChoice[] = knownFonts.map(font => ({ ...font, ...buildGoogleFont(font.name)! }));

export function applyFontChoice(current: ThemeSettings, font: GoogleFontSettings): ThemeSettings {
  const { customFontUrl: _previousFontUrl, ...rest } = current;
  const isBundled = knownFonts.some(choice => choice.name === font.name);
  return { ...rest, fontFamily: font.fontFamily, ...(isBundled ? {} : { customFontUrl: font.customFontUrl }) };
}

// Returns the six-digit representation expected by native color inputs. No alpha or CSS functions.
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return /^#?[a-f\d]{6}$/i.test(value) ? `#${value.replace(/^#/, '').toLowerCase()}` : null;
}
export function isValidHexColor(input: unknown): boolean { return normalizeHexColor(input) !== null; }

export function applyColorPreset(current: ThemeSettings, presetOrId: ThemeColors | string): ThemeSettings {
  const preset = typeof presetOrId === 'string' ? COLOR_PRESETS.find(item => item.id === presetOrId) : presetOrId;
  if (!preset) throw new Error('مجموعة الألوان غير متاحة.');
  const colors = Object.fromEntries((['primary', 'secondary', 'accent', 'background'] as const).map(key => {
    const value = normalizeHexColor(preset[key]);
    if (!value) throw new Error('الألوان تحتاج ست خانات صحيحة، مثل #2563eb.');
    return [key, value];
  })) as ThemeColors;
  return { ...current, ...colors };
}

function relativeLuminance(color: string): number {
  const normalized = normalizeHexColor(color);
  if (!normalized) throw new Error('حساب التباين يتطلب لون HEX من ست خانات.');
  const channels = [1, 3, 5].map(start => parseInt(normalized.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

// WCAG relative luminance and contrast: (lighter + .05) / (darker + .05).
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
// This evaluates one opaque color pair; it does not certify accessibility of the whole interface.
export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}
export function readableForeground(background: string): '#000000' | '#ffffff' {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';
}

export function validateClinicName(input: unknown): NameValidation {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return { valid: false, value, error: 'اكتب اسم العيادة.' };
  if (Array.from(value).length > 100) return { valid: false, value, error: 'اسم العيادة يجب ألا يتجاوز ١٠٠ حرف.' };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { valid: false, value, error: 'اسم العيادة يُكتب في سطر واحد دون رموز تحكم.' };
  return { valid: true, value, error: null };
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export function validateLogoMetadata(metadata: unknown): MetadataValidation {
  if (!metadata || typeof metadata !== 'object') return { valid: false, error: 'اختر صورة للشعار.' };
  const { type, size } = metadata as { type?: unknown; size?: unknown };
  if (typeof type !== 'string' || !ALLOWED_LOGO_MIME_TYPES.some(mime => mime === type.toLowerCase())) return { valid: false, error: 'اختر صورة PNG أو JPG أو WebP فقط.' };
  if (typeof size !== 'number' || !Number.isFinite(size) || !Number.isInteger(size) || size <= 0) return { valid: false, error: 'ملف الصورة فارغ أو غير صالح.' };
  if (size > MAX_LOGO_BYTES) return { valid: false, error: 'حجم الشعار يجب ألا يتجاوز ٢ ميجابايت.' };
  return { valid: true, error: null };
}

// Discarding a preview uses a fresh copy of saved settings rather than mutating the saved object.
export function cloneIdentityDraft(saved: IdentityDraft): IdentityDraft {
  return { clinicName: saved.clinicName, clinicLogo: saved.clinicLogo, theme: { ...saved.theme } };
}
