import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import {
  compressInvoiceImage, createInvoiceImageCompressor, INVOICE_IMAGE_COMPRESSION_LIMITS,
  type InvoiceImageCompressionRuntime,
} from './invoiceImageCompression';

// Fabricated headers only. No real image, patient, network, SDK, or storage fixture.
function jpeg(width = 1200, height = 1600, size = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 23));
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}
const asBlob = (bytes: Uint8Array, type = 'image/jpeg') => new Blob([bytes as BlobPart], { type });
function be32(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint32(offset, value); }
function le32(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint32(offset, value, true); }
function png(width = 1200, height = 1600, animated = false): Uint8Array {
  const bytes = new Uint8Array(animated ? 77 : 57);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); be32(bytes, 8, 13);
  bytes.set(Buffer.from('IHDR'), 12); be32(bytes, 16, width); be32(bytes, 20, height); bytes.set([8, 6, 0, 0, 0], 24);
  let offset = 33;
  if (animated) { be32(bytes, offset, 8); bytes.set(Buffer.from('acTL'), offset + 4); offset += 20; }
  be32(bytes, offset, 0); bytes.set(Buffer.from('IDAT'), offset + 4); offset += 12;
  be32(bytes, offset, 0); bytes.set(Buffer.from('IEND'), offset + 4);
  return bytes;
}
function webp(width = 1200, height = 1600, lossless = true): Uint8Array {
  const bytes = new Uint8Array(lossless ? 26 : 30);
  bytes.set(Buffer.from('RIFF')); le32(bytes, 4, bytes.length - 8); bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from(lossless ? 'VP8L' : 'VP8 '), 12); le32(bytes, 16, lossless ? 5 : 10);
  if (lossless) { bytes[20] = 0x2f; le32(bytes, 21, (width - 1) + (height - 1) * 16384); }
  else { bytes.set([0, 0, 0, 0x9d, 1, 0x2a, width & 255, width >> 8, height & 255, height >> 8], 20); }
  return bytes;
}
function harness(options: {
  width?: number; height?: number;
  decode?: InvoiceImageCompressionRuntime['decode'];
  encode?: (width: number, height: number, quality: number, attempt: number) => Promise<Blob | null>;
  paint?: () => void; create?: () => void; release?: () => void;
} = {}) {
  let decodes = 0, releasedImages = 0, releasedCanvases = 0, paints = 0;
  const sizes: number[][] = [], qualities: number[] = [];
  const runtime: InvoiceImageCompressionRuntime = {
    async decode(file, signal) {
      decodes++;
      if (options.decode) return options.decode(file, signal);
      return { width: options.width ?? 1200, height: options.height ?? 1600, source: {}, release() { releasedImages++; options.release?.(); } };
    },
    createCanvas(width, height) {
      options.create?.(); sizes.push([width, height]);
      return {
        paintWhite() { paints++; options.paint?.(); },
        async encode(quality) {
          qualities.push(quality);
          return options.encode ? options.encode(width, height, quality, qualities.length) : asBlob(jpeg(width, height));
        },
        release() { releasedCanvases++; },
      };
    },
  };
  return { compress: createInvoiceImageCompressor(runtime), runtime, sizes, qualities,
    get decodes() { return decodes; }, get releasedImages() { return releasedImages; }, get releasedCanvases() { return releasedCanvases; }, get paints() { return paints; } };
}
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError' && !error.message.includes('PRIVATE');
const safeError = (error: unknown) => error instanceof Error && /[\u0600-\u06ff]/.test(error.message) && !/PRIVATE|https?:|\/secret/.test(error.message);
const flush = async () => { for (let step = 0; step < 12; step++) await Promise.resolve(); };

test('importing the module does not touch DOM, browser decoders, network, storage or SDK', () => {
  const built = buildSync({ entryPoints: [fileURLToPath(new URL('./invoiceImageCompression.ts', import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'neutral', logLevel: 'silent' });
  const text = built.outputFiles[0].text;
  const module = { exports: {} as Record<string, unknown> };
  const unavailable = () => { throw new Error('PRIVATE_SIDE_EFFECT'); };
  new Function('module', 'exports', 'document', 'Image', 'createImageBitmap', 'fetch', 'localStorage', text)(module, module.exports, new Proxy({}, { get: unavailable }), unavailable, unavailable, unavailable, new Proxy({}, { get: unavailable }));
  assert.equal(typeof module.exports.compressInvoiceImage, 'function');
  assert.doesNotMatch(text, /firebase|https?:\/\/|fetch\(/);
});

test('JPEG result is frozen, exact-byte base64, correctly labelled and <=150KiB', async () => {
  const h = harness(); const source = asBlob(jpeg(1200, 1600, 512)); const output = await h.compress(source);
  assert.deepEqual(output, { dataUrl: 'data:image/jpeg;base64,' + Buffer.from(jpeg()).toString('base64'), mimeType: 'image/jpeg', originalBytes: 512, byteLength: 64, width: 1200, height: 1600 });
  assert.ok(Object.isFrozen(output)); assert.equal(h.decodes, 1); assert.equal(h.paints, 1);
  assert.equal(h.releasedImages, 1); assert.equal(h.releasedCanvases, 1); assert.deepEqual(h.qualities, [0.88]);
  assert.equal(Buffer.from(output.dataUrl.split(',')[1], 'base64').length, output.byteLength);
});

for (const [name, bytes, type] of [['PNG', png(), 'image/png'], ['lossy WebP', webp(1200, 1600, false), 'image/webp'], ['lossless WebP', webp(), 'image/webp'], ['unlabelled JPEG', jpeg(), '']] as const) {
  test(`${name} preflight accepts matching magic and produces only verified JPEG`, async () => {
    const h = harness(); const result = await h.compress(asBlob(bytes, type));
    assert.equal(result.mimeType, 'image/jpeg'); assert.match(result.dataUrl, /^data:image\/jpeg;base64,/); assert.equal(h.decodes, 1);
  });
}

test('empty, invalid, oversized, spoofed MIME and non-raster formats fail before decoding', async () => {
  const h = harness();
  for (const file of [new Blob([]), asBlob(jpeg(), 'image/svg+xml'), asBlob(png(), 'image/jpeg'), asBlob(jpeg(), 'image/png'),
    asBlob(new Uint8Array([0xff, 0xd8, 0xff])), asBlob(Buffer.from('<svg>PRIVATE</svg>'), 'image/png'),
    asBlob(Buffer.from('GIF89a'), 'image/webp'), new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), {} as Blob]) {
    await assert.rejects(h.compress(file), safeError);
  }
  assert.equal(h.decodes, 0); assert.deepEqual(h.sizes, []);
});

test('8MiB inclusive input ceiling is accepted, with result actual bytes not source bytes', async () => {
  const h = harness(); const result = await h.compress(asBlob(jpeg(1200, 1600, 8 * 1024 * 1024)));
  assert.equal(result.originalBytes, 8 * 1024 * 1024); assert.equal(result.byteLength, 64);
});

test('unsafe dimensions, pixel bombs, tiny or extreme-aspect sources are rejected before native allocation', async () => {
  const h = harness();
  for (const [width, height] of [[0, 1600], [1200, 0], [8193, 1600], [6000, 5000], [100, 1000], [300, 300], [300, 2000]]) {
    for (const [bytes, type] of [[jpeg(width, height), 'image/jpeg'], [png(width, height), 'image/png'], [webp(Math.max(1, width), Math.max(1, height)), 'image/webp']] as const) {
      await assert.rejects(h.compress(asBlob(bytes, type)), safeError);
    }
  }
  assert.equal(h.decodes, 0); assert.deepEqual(h.sizes, []);
});

test('animated, truncated, inconsistent and malformed image containers fail before decoder', async () => {
  const brokenPng = png(); be32(brokenPng, 33, 1000);
  const badDepth = png(); badDepth[24] = 3;
  const badJpeg = jpeg(); badJpeg[4] = 0xff;
  const badWebp = webp(); le32(badWebp, 4, 4);
  const unsupportedWebp = webp(); unsupportedWebp.set(Buffer.from('ANIM'), 12);
  const h = harness();
  for (const file of [asBlob(png(1200, 1600, true), 'image/png'), asBlob(brokenPng, 'image/png'), asBlob(badDepth, 'image/png'), asBlob(badJpeg),
    asBlob(webp().subarray(0, 24), 'image/webp'), asBlob(badWebp, 'image/webp'), asBlob(unsupportedWebp, 'image/webp')]) await assert.rejects(h.compress(file), safeError);
  assert.equal(h.decodes, 0);
});

test('decoded dimensions must match preflight including native 90-degree EXIF orientation', async () => {
  const rotated = harness({ width: 1600, height: 1200 });
  assert.deepEqual((({ width, height }) => ({ width, height }))(await rotated.compress(asBlob(jpeg()))), { width: 1600, height: 1200 });
  const wrong = harness({ width: 1400, height: 1600 });
  await assert.rejects(wrong.compress(asBlob(jpeg())), safeError);
  assert.equal(wrong.releasedImages, 1); assert.deepEqual(wrong.sizes, []);
  for (const [width, height] of [[NaN, 1600], [1200, Infinity], [1200.5, 1600], [9000, 9000]]) {
    const h = harness({ width, height }); await assert.rejects(h.compress(asBlob(jpeg())), safeError); assert.equal(h.releasedImages, 1);
  }
});

test('serial quality then dimension steps preserve aspect, never upscale, and stop at first bounded result', async () => {
  const h = harness({ width: 3000, height: 4000, encode: async (width, height, _quality, attempt) => asBlob(jpeg(width, height, attempt < 5 ? 150 * 1024 + 1 : 150 * 1024)) });
  const result = await h.compress(asBlob(jpeg(3000, 4000)));
  assert.deepEqual(h.sizes, [[1200, 1600], [1050, 1400]]); assert.deepEqual(h.qualities, [0.88, 0.78, 0.68, 0.88, 0.78]);
  assert.equal(result.byteLength, 150 * 1024); assert.equal(result.dataUrl.length, 23 + 200 * 1024); assert.equal(h.decodes, 1); assert.equal(h.releasedCanvases, 2);
  const small = harness({ width: 480, height: 640 }); await small.compress(asBlob(jpeg(480, 640))); assert.deepEqual(small.sizes, [[480, 640]]);
});

test('an image that cannot fit fails after <=12 encodes without original fallback or blurry unbounded reduction', async () => {
  const h = harness({ encode: async (width, height) => asBlob(jpeg(width, height, 150 * 1024 + 1)) });
  await assert.rejects(h.compress(asBlob(jpeg())), error => safeError(error) && /وضوحها/.test((error as Error).message));
  assert.equal(h.decodes, 1); assert.equal(h.qualities.length, 12); assert.equal(h.releasedCanvases, 4); assert.equal(h.releasedImages, 1);
  assert.deepEqual(h.sizes, [[1200, 1600], [1050, 1400], [900, 1200], [768, 1024]]); assert.equal(Math.min(...h.qualities), 0.68);
  assert.equal(INVOICE_IMAGE_COMPRESSION_LIMITS.maxEncodeAttempts, 12);
});

test('narrow receipts stop before the short side becomes unreadably small', async () => {
  const h = harness({ width: 400, height: 2400, encode: async (width, height) => asBlob(jpeg(width, height, 150 * 1024 + 1)) });
  await assert.rejects(h.compress(asBlob(jpeg(400, 2400))), safeError);
  assert.deepEqual(h.sizes, [[267, 1600]]); assert.equal(h.qualities.length, 3); assert.equal(h.releasedCanvases, 1);
});

test('null, empty, mislabeled, non-JPEG, truncated or dimension-mismatched encoder results never publish', async () => {
  for (const encoded of [null, new Blob([], { type: 'image/jpeg' }), asBlob(jpeg(), 'image/png'), asBlob(png(), 'image/jpeg'),
    asBlob(jpeg().subarray(0, 40)), asBlob(jpeg(1300, 1600)), asBlob(Buffer.from('PRIVATE_ENCODER_PAYLOAD'))]) {
    const h = harness({ encode: async () => encoded });
    await assert.rejects(h.compress(asBlob(jpeg())), safeError);
    assert.equal(h.releasedImages, 1); assert.equal(h.releasedCanvases, 1); assert.equal(h.qualities.length, 1);
  }
});

test('aborted-before-start work performs no decoding or raster allocation', async () => {
  const abort = new AbortController(); abort.abort(); const h = harness();
  await assert.rejects(h.compress(asBlob(jpeg()), { signal: abort.signal }), isAbort);
  assert.equal(h.decodes, 0); assert.deepEqual(h.sizes, []);
  await assert.rejects(compressInvoiceImage(asBlob(jpeg()), { signal: abort.signal }), isAbort);
});

test('abort while reading input never enters native decoder even if bytes resolve later', async () => {
  let finish!: (value: ArrayBuffer) => void;
  const source = asBlob(jpeg()); Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  const abort = new AbortController(), h = harness(); const pending = h.compress(source, { signal: abort.signal });
  abort.abort(); await assert.rejects(pending, isAbort); finish(jpeg().buffer as ArrayBuffer); await flush();
  assert.equal(h.decodes, 0); assert.deepEqual(h.sizes, []);
});

test('abort while decoding rejects promptly and releases a late native bitmap exactly once', async () => {
  let finish!: (value: Awaited<ReturnType<InvoiceImageCompressionRuntime['decode']>>) => void, released = 0;
  const h = harness({ decode: () => new Promise(resolve => { finish = resolve; }) });
  const abort = new AbortController(), pending = h.compress(asBlob(jpeg()), { signal: abort.signal }); await flush();
  assert.equal(h.decodes, 1); abort.abort(); await assert.rejects(pending, isAbort);
  finish({ width: 1200, height: 1600, source: {}, release() { released++; } }); await flush();
  assert.equal(released, 1); assert.deepEqual(h.sizes, []);
});

test('abort during JPEG encoding clears canvas and bitmap and ignores late encoder output', async () => {
  let finish!: (value: Blob) => void;
  const h = harness({ encode: () => new Promise(resolve => { finish = resolve; }) });
  const abort = new AbortController(), pending = h.compress(asBlob(jpeg()), { signal: abort.signal }); await flush();
  assert.equal(h.qualities.length, 1); abort.abort(); await assert.rejects(pending, isAbort);
  assert.equal(h.releasedImages, 1); assert.equal(h.releasedCanvases, 1); finish(asBlob(jpeg())); await flush();
  assert.equal(h.qualities.length, 1); assert.equal(h.releasedCanvases, 1);
});

test('abort immediately after native callback still prevents output', async () => {
  const abort = new AbortController();
  const h = harness({ encode: async () => { abort.abort(); return asBlob(jpeg()); } });
  await assert.rejects(h.compress(asBlob(jpeg()), { signal: abort.signal }), isAbort);
  assert.equal(h.releasedImages, 1); assert.equal(h.releasedCanvases, 1);
});

test('abort while verifying encoded bytes prevents base64 publication and releases all resources', async () => {
  let finish!: (value: ArrayBuffer) => void;
  const encoded = asBlob(jpeg()); Object.defineProperty(encoded, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  const h = harness({ encode: async () => encoded });
  const abort = new AbortController(), pending = h.compress(asBlob(jpeg()), { signal: abort.signal }); await flush();
  assert.equal(typeof finish, 'function'); abort.abort(); await assert.rejects(pending, isAbort);
  finish(jpeg().buffer as ArrayBuffer); await flush();
  assert.equal(h.releasedImages, 1); assert.equal(h.releasedCanvases, 1); assert.equal(h.qualities.length, 1);
});

test('native decode timeout does not strand a late bitmap or allocate a canvas', async () => {
  const originalTimer = globalThis.setTimeout;
  let finish!: (value: Awaited<ReturnType<InvoiceImageCompressionRuntime['decode']>>) => void, released = 0;
  const h = harness({ decode: () => new Promise(resolve => { finish = resolve; }) });
  try {
    // Accelerate only the bounded native-decode timer, not byte reading or a global sleep.
    globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => originalTimer(callback, delay! > 8000 && delay! <= 10_000 ? 0 : delay, ...args)) as typeof setTimeout;
    await assert.rejects(h.compress(asBlob(jpeg())), error => safeError(error) && /وقتًا طويلًا/.test((error as Error).message));
    finish({ width: 1200, height: 1600, source: {}, release() { released++; } }); await flush();
    assert.equal(released, 1); assert.deepEqual(h.sizes, []);
  } finally { globalThis.setTimeout = originalTimer; }
});

test('raw errors at decode, allocation, paint, encode or cleanup never leak private details', async () => {
  const secret = () => { throw new Error('PRIVATE /secret https://private.invalid'); };
  const cases = [harness({ decode: async () => secret() }), harness({ create: secret }), harness({ paint: secret }), harness({ encode: async () => secret() })];
  for (const h of cases) await assert.rejects(h.compress(asBlob(jpeg())), safeError);
  assert.equal(cases[1].releasedImages, 1); assert.equal(cases[2].releasedCanvases, 1); assert.equal(cases[3].releasedCanvases, 1);
  const cleanup = harness({ release: secret }); const output = await cleanup.compress(asBlob(jpeg())); assert.equal(output.byteLength, 64);
});

test('whole-operation deadline is checked after awaits and before any raster work', async () => {
  const original = Date.now; let now = 1000;
  const h = harness({ decode: async () => { now += 20_001; return { width: 1200, height: 1600, source: {}, release() {} }; } });
  try { Date.now = () => now; await assert.rejects(h.compress(asBlob(jpeg())), error => safeError(error) && /وقتًا طويلًا/.test((error as Error).message)); assert.deepEqual(h.sizes, []); }
  finally { Date.now = original; }
});

function installBrowser(options: { bitmap?: boolean; bitmapReject?: boolean; imageError?: boolean; imagePending?: boolean; context?: boolean; nullBlob?: boolean } = {}) {
  const names = ['document', 'Image', 'createImageBitmap', 'URL'] as const;
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  let decoded = 0, closed = 0, objectUrls = 0, revoked = 0, removed = 0;
  const drawing: unknown[][] = [], canvases: any[] = [];
  set('document', { createElement(name: string) {
    assert.equal(name, 'canvas');
    const context = { fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: '', fillRect(...args: unknown[]) { drawing.push(['fill', this.fillStyle, ...args]); }, drawImage(...args: unknown[]) { drawing.push(['draw', ...args]); } };
    const canvas = { width: 0, height: 0, getContext(...args: unknown[]) { drawing.push(['context', ...args]); return options.context === false ? null : context; },
      toBlob(callback: BlobCallback, mime: string, quality: number) { assert.equal(mime, 'image/jpeg'); assert.equal(quality, 0.88); queueMicrotask(() => callback(options.nullBlob ? null : asBlob(jpeg(this.width, this.height)))); }, remove() { removed++; } };
    canvases.push(canvas); return canvas;
  } });
  set('URL', { createObjectURL() { objectUrls++; return 'blob:synthetic-only'; }, revokeObjectURL(url: string) { assert.equal(url, 'blob:synthetic-only'); revoked++; } });
  set('Image', class {
    onload: (() => void) | null = null; onerror: (() => void) | null = null; naturalWidth = 1200; naturalHeight = 1600; private value = '';
    set src(value: string) { this.value = value; if (value) { decoded++; if (!options.imagePending) queueMicrotask(() => options.imageError ? this.onerror?.() : this.onload?.()); } }
    get src() { return this.value; }
  });
  set('createImageBitmap', options.bitmap === false ? undefined : async (_blob: Blob, opts: unknown) => { decoded++; assert.deepEqual(opts, { imageOrientation: 'from-image' }); if (options.bitmapReject) throw new Error('PRIVATE_DECODE'); return { width: 1200, height: 1600, close() { closed++; } }; });
  return { drawing, canvases, get decoded() { return decoded; }, get closed() { return closed; }, get objectUrls() { return objectUrls; }, get revoked() { return revoked; }, get removed() { return removed; },
    restore() { for (const name of names) { const descriptor = originals.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } } };
}

test('native adapter decodes once with orientation, paints white, and releases bitmap and canvas', async () => {
  const h = installBrowser();
  try {
    const output = await compressInvoiceImage(asBlob(jpeg())); assert.equal(output.width, 1200); assert.equal(h.decoded, 1); assert.equal(h.closed, 1); assert.equal(h.objectUrls, 0);
    assert.deepEqual(h.drawing[0], ['context', '2d', { alpha: false }]); assert.deepEqual(h.drawing[1], ['fill', '#ffffff', 0, 0, 1200, 1600]); assert.equal(h.drawing[2][0], 'draw');
    assert.equal(h.canvases[0].width, 0); assert.equal(h.canvases[0].height, 0); assert.equal(h.removed, 1);
  } finally { h.restore(); }
});

test('image-element fallback releases its object URL on success and decode failure', async () => {
  for (const imageError of [false, true]) {
    const h = installBrowser({ bitmap: false, imageError });
    try { if (imageError) await assert.rejects(compressInvoiceImage(asBlob(jpeg())), safeError); else await compressInvoiceImage(asBlob(jpeg()));
      assert.equal(h.decoded, 1); assert.equal(h.objectUrls, 1); assert.equal(h.revoked, 1); assert.equal(h.closed, 0);
    } finally { h.restore(); }
  }
});

test('image-element fallback abort cleans its pending object URL without waiting for image load', async () => {
  const h = installBrowser({ bitmap: false, imagePending: true }), abort = new AbortController();
  try {
    const pending = compressInvoiceImage(asBlob(jpeg()), { signal: abort.signal }); await flush(); assert.equal(h.objectUrls, 1);
    abort.abort(); await assert.rejects(pending, isAbort); assert.equal(h.revoked, 1); assert.equal(h.decoded, 1); assert.equal(h.canvases.length, 0);
  } finally { h.restore(); }
});

test('actual bitmap adapter abort disposes a bitmap returned after cancellation, without Image fallback', async () => {
  const h = installBrowser(); let finish!: (value: ImageBitmap) => void, closed = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: () => new Promise<ImageBitmap>(resolve => { finish = resolve; }) });
  const abort = new AbortController();
  try {
    const pending = compressInvoiceImage(asBlob(jpeg()), { signal: abort.signal }); await flush(); assert.equal(typeof finish, 'function');
    abort.abort(); await assert.rejects(pending, isAbort);
    finish({ width: 1200, height: 1600, close() { closed++; } } as ImageBitmap); await flush();
    assert.equal(closed, 1); assert.equal(h.objectUrls, 0); assert.equal(h.canvases.length, 0);
  } finally { h.restore(); }
});

test('native decode failure never retries Image fallback; allocation and encoder failures clean resources', async () => {
  for (const options of [{ bitmapReject: true }, { context: false }, { nullBlob: true }]) {
    const h = installBrowser(options);
    try { await assert.rejects(compressInvoiceImage(asBlob(jpeg())), safeError); assert.equal(h.decoded, 1); assert.equal(h.objectUrls, 0);
      if (!options.bitmapReject) { assert.equal(h.closed, 1); assert.equal(h.removed, 1); assert.equal(h.canvases[0].width, 0); }
    } finally { h.restore(); }
  }
});

test('browser wrapper fails safely in SSR rather than accessing global DOM', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'); Reflect.deleteProperty(globalThis, 'document');
  try { await assert.rejects(compressInvoiceImage(asBlob(jpeg())), error => safeError(error) && /متصفحك/.test((error as Error).message)); }
  finally { if (original) Object.defineProperty(globalThis, 'document', original); }
});
