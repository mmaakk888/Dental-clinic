import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_LOGO_MIME_TYPES, COLOR_PRESETS, DEFAULT_THEME, FONT_CHOICES, MAX_LOGO_BYTES, applyColorPreset, applyFontChoice, buildGoogleFont, cloneIdentityDraft, contrastRatio, isValidHexColor, normalizeHexColor, readableForeground, validateClinicName, validateLogoMetadata } from './clinicIdentity';

test('switching from a custom font to a bundled font removes the previous stylesheet URL', () => {
  const current = { ...DEFAULT_THEME, ...buildGoogleFont('Almarai')! };
  const selected = applyFontChoice(current, FONT_CHOICES[1]);
  assert.equal(selected.fontFamily, "'Tajawal', sans-serif");
  assert.equal(selected.customFontUrl, undefined);
  assert.equal(current.customFontUrl, buildGoogleFont('Almarai')!.customFontUrl);
  assert.equal(selected.primary, current.primary);
});

test('custom font choice preserves colors and uses its validated stylesheet', () => {
  const font = buildGoogleFont('Almarai')!;
  const selected = applyFontChoice(DEFAULT_THEME, font);
  assert.equal(selected.customFontUrl, font.customFontUrl);
  assert.equal(selected.background, DEFAULT_THEME.background);
});

test('six existing color presets retain custom font fields without mutating the saved theme', () => {
  assert.equal(COLOR_PRESETS.length, 6);
  assert.equal(new Set(COLOR_PRESETS.map(preset => preset.id)).size, 6);
  const saved = { ...DEFAULT_THEME, fontFamily: "'Custom 2', sans-serif", customFontUrl: 'https://fonts.googleapis.com/css2?family=Custom+2:wght@400;700&display=swap' };
  const original = { ...saved };
  for (const preset of COLOR_PRESETS) {
    const next = applyColorPreset(saved, preset.id);
    assert.equal(next.primary, preset.primary);
    assert.equal(next.fontFamily, saved.fontFamily);
    assert.equal(next.customFontUrl, saved.customFontUrl);
    assert.notEqual(next, saved);
  }
  assert.deepEqual(saved, original);
});
test('preset merge accepts valid custom colors and rejects unknown or malformed presets', () => {
  const next = applyColorPreset(DEFAULT_THEME, { primary: '#ABCDEF', secondary: '#123456', accent: '#000000', background: '#FFFFFF' });
  assert.equal(next.primary, '#abcdef');
  assert.equal(next.background, '#ffffff');
  assert.throws(() => applyColorPreset(DEFAULT_THEME, 'does-not-exist'));
  assert.throws(() => applyColorPreset(DEFAULT_THEME, { ...DEFAULT_THEME, primary: 'url(https://example.com)' }));
});
test('discard draft returns the complete saved identity and an independent theme', () => {
  const saved = { clinicName: 'عيادة محفوظة', clinicLogo: 'data:image/png;base64,original', theme: { ...DEFAULT_THEME, customFontUrl: 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap' } };
  const draft = cloneIdentityDraft(saved);
  draft.clinicName = 'اسم تجريبي';
  draft.clinicLogo = null;
  draft.theme.primary = '#000000';
  const reset = cloneIdentityDraft(saved);
  assert.deepEqual(reset, saved);
  assert.notEqual(reset.theme, saved.theme);
  assert.equal(saved.theme.primary, DEFAULT_THEME.primary);
});
test('eight existing font choices use safe names and regular/bold URLs including static Amiri', () => {
  assert.equal(FONT_CHOICES.length, 8);
  assert.equal(new Set(FONT_CHOICES.map(font => font.id)).size, 8);
  for (const font of FONT_CHOICES) {
    const url = new URL(font.customFontUrl);
    assert.equal(url.origin, 'https://fonts.googleapis.com');
    assert.equal(url.pathname, '/css2');
    assert.equal(url.searchParams.get('family'), `${font.name}:wght@400;700`);
    assert.equal(url.searchParams.get('display'), 'swap');
  }
  assert.equal(FONT_CHOICES.find(font => font.id === 'amiri')!.fontFamily, "'Amiri', serif");
});
test('font builder trims and normalizes spaces, known casing, and bounded Latin family names', () => {
  assert.deepEqual(buildGoogleFont('  cAiRo  '), buildGoogleFont('Cairo'));
  assert.equal(buildGoogleFont('IBM   Plex Sans Arabic')!.name, 'IBM Plex Sans Arabic');
  assert.equal(buildGoogleFont('Noto Sans Arabic 2')!.fontFamily, "'Noto Sans Arabic 2', sans-serif");
  assert.ok(buildGoogleFont('A'.repeat(60)));
  assert.equal(buildGoogleFont('A'.repeat(61)), null);
  assert.equal(buildGoogleFont('Ab'), null);
});
test('font builder rejects URLs, CSS injection, control characters and non-name input', () => {
  for (const name of ['https://example.com/font.css', '//fonts.googleapis.com', 'Cairo:wght@400', "Cairo';color:red;/*", 'Cairo&family=Other', 'Cairo+Tajawal', 'Cairo\nTajawal', 'Cairo\tTajawal', 'خط عربي', '', '123', 'Cairo<script>', 'Cairo\\Font']) assert.equal(buildGoogleFont(name), null, name);
  assert.equal(buildGoogleFont(null), null);
  assert.equal(buildGoogleFont({ name: 'Cairo' }), null);
});
test('hex normalization accepts six digits only and rejects CSS or alpha input', () => {
  assert.equal(normalizeHexColor(' #AbC123 '), '#abc123');
  assert.equal(normalizeHexColor('ABCDEF'), '#abcdef');
  for (const invalid of ['#abc', '#abcdef00', '#12345g', 'red', 'rgb(0,0,0)', '#000000; color:red', '', '##123456']) assert.equal(normalizeHexColor(invalid), null, invalid);
  assert.equal(normalizeHexColor(null), null);
  assert.equal(isValidHexColor('#ffffff'), true);
  assert.equal(isValidHexColor('#fff'), false);
});
test('contrast uses exact opaque-color luminance with black/white boundaries and symmetry', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#abcdef', '#abcdef'), 1);
  assert.equal(contrastRatio('#123456', '#abcdef'), contrastRatio('#abcdef', '#123456'));
  // Near the normal-text 4.5 ratio boundary; this does not assert whole-app compliance.
  assert.ok(contrastRatio('#767676', '#ffffff') > 4.5);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
  assert.throws(() => contrastRatio('#xyzxyz', '#ffffff'));
});
test('readable foreground chooses the higher-contrast black or white without rounding', () => {
  assert.equal(readableForeground('#000000'), '#ffffff');
  assert.equal(readableForeground('#ffffff'), '#000000');
  for (const color of ['#777777', '#059669', '#2563eb', '#fb7185']) {
    const foreground = readableForeground(color);
    const other = foreground === '#000000' ? '#ffffff' : '#000000';
    assert.ok(contrastRatio(color, foreground) >= contrastRatio(color, other));
  }
});
test('clinic name is trimmed, allows Arabic, and enforces one to 100 Unicode characters', () => {
  assert.deepEqual(validateClinicName('  عيادة الأسنان  '), { valid: true, value: 'عيادة الأسنان', error: null });
  assert.equal(validateClinicName('أ').valid, true);
  assert.equal(validateClinicName('أ'.repeat(100)).valid, true);
  assert.equal(validateClinicName('أ'.repeat(101)).valid, false);
  assert.equal(validateClinicName(' ').valid, false);
  assert.equal(validateClinicName(null).valid, false);
  assert.equal(validateClinicName('عيادة\nأسنان').valid, false);
});
test('logo metadata permits PNG/JPEG/WebP including exact size limit before image decode', () => {
  for (const type of ALLOWED_LOGO_MIME_TYPES) assert.equal(validateLogoMetadata({ type, size: MAX_LOGO_BYTES }).valid, true);
  assert.equal(validateLogoMetadata({ type: 'IMAGE/PNG', size: 1, width: 200, height: 200 }).valid, true);
  assert.equal(validateLogoMetadata({ type: 'image/png', size: MAX_LOGO_BYTES + 1 }).valid, false);
});
test('logo metadata rejects empty, nonfinite, noninteger or non-image files without reading them', () => {
  for (const metadata of [null, {}, { type: 'image/svg+xml', size: 1 }, { type: 'image/gif', size: 1 }, { type: 'text/html', size: 1 }, { type: 'image/png', size: 0 }, { type: 'image/png', size: -1 }, { type: 'image/png', size: NaN }, { type: 'image/png', size: Infinity }, { type: 'image/png', size: 1.5 }, { type: 'image/png', size: '100' }]) assert.equal(validateLogoMetadata(metadata).valid, false);
});
