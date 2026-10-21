/** Browser-only, bounded invoice preparation. Importing this module does no DOM work. */
export const INVOICE_IMAGE_COMPRESSION_LIMITS = Object.freeze({
  maxInputBytes: 8 * 1024 * 1024,
  maxInputSide: 8192,
  maxInputPixels: 24_000_000,
  maxOutputBytes: 150 * 1024,
  maxOutputSide: 1600,
  minResizedLongSide: 1024,
  minQuality: 0.68,
  maxEncodeAttempts: 12,
});

export interface CompressedInvoiceImage {
  dataUrl: string;
  mimeType: 'image/jpeg';
  originalBytes: number;
  byteLength: number;
  width: number;
  height: number;
}
export interface InvoiceImageCompressionOptions { signal?: AbortSignal }
export interface DecodedInvoiceImage {
  width: number;
  height: number;
  source: unknown;
  release(): void;
}
export interface InvoiceImageCompressionCanvas {
  paintWhite(image: DecodedInvoiceImage): void;
  encode(quality: number): Promise<Blob | null>;
  release(): void;
}
/** Injection seam for synthetic tests; production always uses the native adapter below. */
export interface InvoiceImageCompressionRuntime {
  decode(file: Blob, signal?: AbortSignal): Promise<DecodedInvoiceImage>;
  createCanvas(width: number, height: number): InvoiceImageCompressionCanvas;
}

const MESSAGES = Object.freeze({
  format: 'اختر صورة فاتورة سليمة بصيغة JPG أو PNG أو WebP.',
  inputSize: 'حجم الصورة أكبر من ٨ ميجابايت. صغّرها ثم حاول مرة أخرى.',
  geometry: 'أبعاد الصورة غير مناسبة للمعالجة الآمنة. صغّرها أو قسّم الفاتورة الطويلة ثم حاول مرة أخرى.',
  fit: 'تعذّر ضغط الصورة لحجم مناسب مع الحفاظ على وضوحها. قرّب التصوير أو قسّم الفاتورة ثم حاول مرة أخرى.',
  unavailable: 'متصفحك لا يدعم تجهيز الصورة. جرّب متصفحًا حديثًا.',
  processing: 'تعذّر تجهيز صورة الفاتورة. حاول بصورة أخرى.',
  timeout: 'استغرق تجهيز الصورة وقتًا طويلًا. جرّب صورة أصغر.',
  cancelled: 'أُلغي تجهيز صورة الفاتورة.',
});
class SafeCompressionError extends Error {}
function fail(kind: keyof typeof MESSAGES): never { throw new SafeCompressionError(MESSAGES[kind]); }
function cancelled(): Error { const error = new Error(MESSAGES.cancelled); error.name = 'AbortError'; return error; }
function check(signal?: AbortSignal, deadline = Infinity): void {
  if (signal?.aborted) throw cancelled();
  if (Date.now() >= deadline) fail('timeout');
}
function release(resource: { release(): void } | undefined): void {
  // Cleanup must not publish a result or mask the original failure.
  try { resource?.release(); } catch { /* browser resources have no recoverable user action */ }
}

/** Race native async work without abandoning a late allocated bitmap. */
function bounded<T>(work: Promise<T>, signal: AbortSignal | undefined, timeout: number, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => reject(cancelled()));
    timer = setTimeout(() => finish(() => reject(new SafeCompressionError(MESSAGES.timeout))), Math.max(1, timeout));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    work.then(value => {
      if (settled) { try { late?.(value); } catch { /* late cleanup only */ } return; }
      finish(() => resolve(value));
    }, error => finish(() => reject(error)));
  });
}

type ImageHeader = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number };
const be16 = (bytes: Uint8Array, offset: number) => bytes[offset] * 256 + bytes[offset + 1];
const le16 = (bytes: Uint8Array, offset: number) => bytes[offset] + bytes[offset + 1] * 256;
const be32 = (bytes: Uint8Array, offset: number) => bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 256 + bytes[offset + 3];
const le24 = (bytes: Uint8Array, offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
const le32 = (bytes: Uint8Array, offset: number) => le24(bytes, offset) + bytes[offset + 3] * 0x1000000;
const tag = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

function geometry(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Math.min(width, height) < 160 ||
      Math.max(width, height) < 320 || Math.max(width, height) > INVOICE_IMAGE_COMPRESSION_LIMITS.maxInputSide ||
      width * height > INVOICE_IMAGE_COMPRESSION_LIMITS.maxInputPixels || Math.max(width, height) / Math.min(width, height) > 6) fail('geometry');
}
function jpegHeader(bytes: Uint8Array): ImageHeader {
  let offset = 2;
  for (let segment = 0; segment < 4096 && offset < bytes.length; segment++) {
    if (bytes[offset++] !== 0xff) fail('format');
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9 || marker === 0xda || (marker >= 0xd0 && marker <= 0xd7)) fail('format');
    if (offset + 2 > bytes.length) fail('format');
    const length = be16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) fail('format');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const components = bytes[offset + 7];
      if (length < 11 || bytes[offset + 2] !== 8 || ![1, 3, 4].includes(components) || length !== 8 + 3 * components) fail('format');
      const height = be16(bytes, offset + 3), width = be16(bytes, offset + 5);
      geometry(width, height);
      return { mimeType: 'image/jpeg', width, height };
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) fail('format');
    offset += length;
  }
  fail('format');
}
function pngHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 45 || be32(bytes, 8) !== 13 || tag(bytes, 12) !== 'IHDR') fail('format');
  const width = be32(bytes, 16), height = be32(bytes, 20);
  geometry(width, height);
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28])) fail('format');
  let offset = 33, imageData = false;
  for (let chunk = 0; chunk < 4096 && offset + 12 <= bytes.length; chunk++) {
    const length = be32(bytes, offset), kind = tag(bytes, offset + 4);
    if (offset + 12 + length > bytes.length || ['IHDR', 'acTL', 'fcTL', 'fdAT'].includes(kind)) fail('format');
    if (kind === 'IDAT') imageData = true;
    if (kind === 'IEND') {
      if (length !== 0 || !imageData || offset + 12 !== bytes.length) fail('format');
      return { mimeType: 'image/png', width, height };
    }
    offset += 12 + length;
  }
  fail('format');
}
function webpHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 26 || le32(bytes, 4) !== bytes.length - 8) fail('format');
  let offset = 12, extended: { width: number; height: number } | undefined;
  let image: { width: number; height: number } | undefined;
  for (let chunk = 0; chunk < 2048 && offset + 8 <= bytes.length; chunk++) {
    const kind = tag(bytes, offset), length = le32(bytes, offset + 4), start = offset + 8;
    if (start + length + (length % 2) > bytes.length || ['ANIM', 'ANMF'].includes(kind)) fail('format');
    if (kind === 'VP8X') {
      if (extended || offset !== 12 || length !== 10 || (bytes[start] & 0xc3) !== 0 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) fail('format');
      extended = { width: le24(bytes, start + 4) + 1, height: le24(bytes, start + 7) + 1 };
      geometry(extended.width, extended.height);
    } else if (kind === 'VP8 ') {
      if (image || length < 10 || (bytes[start] & 1) !== 0 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) fail('format');
      image = { width: le16(bytes, start + 6) & 0x3fff, height: le16(bytes, start + 8) & 0x3fff };
      geometry(image.width, image.height);
    } else if (kind === 'VP8L') {
      if (image || length < 5 || bytes[start] !== 0x2f) fail('format');
      const bits = le32(bytes, start + 1);
      if (Math.floor(bits / 0x20000000) !== 0) fail('format');
      image = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      geometry(image.width, image.height);
    }
    offset = start + length + (length % 2);
  }
  if (offset !== bytes.length || !image || (extended && (extended.width !== image.width || extended.height !== image.height))) fail('format');
  return { mimeType: 'image/webp', ...image };
}
function inspect(bytes: Uint8Array): ImageHeader {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpegHeader(bytes);
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return pngHeader(bytes);
  if (bytes.length >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'WEBP') return webpHeader(bytes);
  fail('format');
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const count = Math.min(3, bytes.length - offset);
    const value = bytes[offset] * 65536 + (bytes[offset + 1] || 0) * 256 + (bytes[offset + 2] || 0);
    parts.push(alphabet[value >>> 18], alphabet[(value >>> 12) & 63], count > 1 ? alphabet[(value >>> 6) & 63] : '=', count > 2 ? alphabet[value & 63] : '=');
  }
  return parts.join('');
}
function outputSizes(width: number, height: number): { width: number; height: number }[] {
  const long = Math.max(width, height), short = Math.min(width, height);
  const result: { width: number; height: number }[] = [];
  for (const side of [1600, 1400, 1200, 1024]) {
    const scale = Math.min(1, side / long);
    const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
    if (Math.min(size.width, size.height) < Math.min(short, 240)) continue;
    if (!result.some(previous => previous.width === size.width && previous.height === size.height)) result.push(size);
  }
  return result;
}

/** Decode once; every attempted raster and encoded result has a fixed size/work ceiling. */
export function createInvoiceImageCompressor(runtime: InvoiceImageCompressionRuntime) {
  return async (file: Blob, options: InvoiceImageCompressionOptions = {}): Promise<CompressedInvoiceImage> => {
    const signal = options.signal, deadline = Date.now() + 20_000;
    let decoded: DecodedInvoiceImage | undefined;
    try {
      check(signal, deadline);
      if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size <= 0) fail('format');
      const originalBytes = file.size, declaredMime = file.type;
      if (originalBytes > INVOICE_IMAGE_COMPRESSION_LIMITS.maxInputBytes) fail('inputSize');
      if (declaredMime && !['image/jpeg', 'image/png', 'image/webp'].includes(declaredMime)) fail('format');
      const buffer = await bounded(file.arrayBuffer(), signal, Math.min(8000, deadline - Date.now()));
      check(signal, deadline);
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== originalBytes) fail('format');
      const header = inspect(new Uint8Array(buffer));
      if (declaredMime && header.mimeType !== declaredMime) fail('format');
      decoded = await bounded<DecodedInvoiceImage>(runtime.decode(file, signal), signal, Math.min(10_000, deadline - Date.now()), release);
      check(signal, deadline);
      geometry(decoded.width, decoded.height);
      // Native decoding applies EXIF orientation; a 90-degree rotation may swap axes.
      if (!((decoded.width === header.width && decoded.height === header.height) ||
            (decoded.width === header.height && decoded.height === header.width))) fail('format');
      for (const size of outputSizes(decoded.width, decoded.height)) {
        check(signal, deadline);
        const canvas = runtime.createCanvas(size.width, size.height);
        try {
          canvas.paintWhite(decoded);
          for (const quality of [0.88, 0.78, 0.68]) {
            check(signal, deadline);
            const blob = await bounded(canvas.encode(quality), signal, Math.min(3000, deadline - Date.now()));
            check(signal, deadline);
            if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || !Number.isSafeInteger(blob.size) || blob.size <= 0) fail('processing');
            if (blob.size > INVOICE_IMAGE_COMPRESSION_LIMITS.maxOutputBytes) continue;
            const encoded = await bounded(blob.arrayBuffer(), signal, Math.min(3000, deadline - Date.now()));
            check(signal, deadline);
            if (!(encoded instanceof ArrayBuffer) || encoded.byteLength !== blob.size) fail('processing');
            const bytes = new Uint8Array(encoded), output = inspect(bytes);
            if (output.mimeType !== 'image/jpeg' || output.width !== size.width || output.height !== size.height ||
                bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) fail('processing');
            const dataUrl = 'data:image/jpeg;base64,' + encodeBase64(bytes);
            if (dataUrl.length !== 23 + Math.ceil(bytes.length / 3) * 4 || dataUrl.length > 23 + Math.ceil(INVOICE_IMAGE_COMPRESSION_LIMITS.maxOutputBytes / 3) * 4) fail('processing');
            check(signal, deadline);
            return Object.freeze({ dataUrl, mimeType: 'image/jpeg' as const, originalBytes, byteLength: bytes.length, ...size });
          }
        } finally { release(canvas); }
      }
      fail('fit');
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw cancelled();
      if (error instanceof SafeCompressionError) throw error;
      fail('processing');
    } finally { release(decoded); }
  };
}

function browserRuntime(): InvoiceImageCompressionRuntime {
  if (typeof document === 'undefined' || typeof URL === 'undefined') fail('unavailable');
  return {
    async decode(file, signal) {
      check(signal);
      if (typeof createImageBitmap === 'function') {
        // Do not retry another decoder: decoding the same untrusted input twice is unbounded work.
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() };
      }
      if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') fail('unavailable');
      const image = new Image(), objectUrl = URL.createObjectURL(file);
      let released = false;
      const cleanup = () => {
        if (released) return;
        released = true;
        image.onload = null; image.onerror = null;
        try { image.src = ''; } finally { URL.revokeObjectURL(objectUrl); }
      };
      try {
        await bounded(new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new SafeCompressionError(MESSAGES.format));
          image.src = objectUrl;
        }), signal, 10_000);
        check(signal);
        image.onload = null; image.onerror = null;
        return { width: image.naturalWidth, height: image.naturalHeight, source: image, release: cleanup };
      } catch (error) { cleanup(); throw error; }
    },
    createCanvas(width, height) {
      const canvas = document.createElement('canvas');
      try {
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context || typeof canvas.toBlob !== 'function') fail('unavailable');
        return {
          paintWhite(image) {
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
            context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
            context.drawImage(image.source as CanvasImageSource, 0, 0, width, height);
          },
          encode: quality => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality)),
          release() { canvas.width = 0; canvas.height = 0; canvas.remove(); },
        };
      } catch (error) { canvas.width = 0; canvas.height = 0; canvas.remove(); throw error; }
    },
  };
}

/** Local processing only; never uploads, stores, invokes AI, or falls back to the original. */
export async function compressInvoiceImage(file: Blob, options: InvoiceImageCompressionOptions = {}): Promise<CompressedInvoiceImage> {
  check(options.signal);
  return createInvoiceImageCompressor(browserRuntime())(file, options);
}
