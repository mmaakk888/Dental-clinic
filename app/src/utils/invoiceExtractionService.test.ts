import test from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../services/aiService';

const IMAGE = 'data:image/jpeg;base64,c3ludGhldGljLW9ubHk=';
const FRIENDLY = 'تعذر استخراج بيانات الفاتورة. راجع اتصال الخدمة أو أدخل البنود يدويًا.';

async function withFetch<T>(replacement: typeof fetch, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = replacement;
  try { return await action(); }
  finally { globalThis.fetch = previous; }
}

test('actual invoice service makes only one explicit same-origin request with the supplied small image', async () => {
  const calls: { input: unknown; init: RequestInit | undefined }[] = [];
  const input = { supplierName: ' مورد مصطنع ', totalAmount: 500, paidAmount: 100,
    remainingAmount: 400, lineItems: [{ itemName: 'صنف مصطنع', quantity: 5, unitPrice: 100, total: 500 }] };
  await withFetch(async (url, init) => {
    calls.push({ input: url, init });
    return { ok: true, json: async () => input } as Response;
  }, async () => {
    const result = await AiService.extractInvoice(IMAGE, 'image/jpeg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, '/api/ai/extract-invoice');
    assert.equal(calls[0].init?.method, 'POST');
    assert.deepEqual(calls[0].init?.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(calls[0].init!.body as string), { imageBase64: IMAGE, mimeType: 'image/jpeg' });
    assert.equal(result.supplierName, 'مورد مصطنع');
    result.lineItems![0].itemName = 'تعديل المسودة';
    assert.equal(input.lineItems[0].itemName, 'صنف مصطنع');
  });
});

test('actual invoice service never fills absent paid money merely because the OCR label is cash', async () => {
  let requests = 0;
  await withFetch(async () => {
    requests++;
    return { ok: true, json: async () => ({ totalAmount: 500, paymentMethod: 'cash' }) } as Response;
  }, async () => {
    const result = await AiService.extractInvoice(IMAGE);
    assert.deepEqual(result, { totalAmount: 500, paymentMethod: 'cash' });
    assert.equal(Object.hasOwn(result, 'paidAmount'), false);
    assert.equal(Object.hasOwn(result, 'remainingAmount'), false);
    assert.equal(requests, 1);
  });
});

test('actual invoice service rejects malformed OCR before it can reach the editor or a save', async () => {
  for (const payload of [null, [], { supplierName: {} }, { totalAmount: '500' },
    { totalAmount: 500, paidAmount: 100, remainingAmount: 300 },
    { lineItems: [{ itemName: {}, quantity: 1, unitPrice: 100, total: 100 }] },
    { lineItems: [{ itemName: 'صنف', quantity: 1, unitPrice: 100, total: 100, discount: -.01 }] },
    { paymentMethod: 'already-paid' }, { apiKey: 'synthetic-private-detail' }]) {
    let requests = 0;
    await withFetch(async () => {
      requests++;
      return { ok: true, json: async () => payload } as Response;
    }, async () => {
      await assert.rejects(AiService.extractInvoice(IMAGE), error => error instanceof Error && error.message === FRIENDLY);
      assert.equal(requests, 1, 'invalid extraction must not trigger another provider attempt');
    });
  }
});

test('disabled, unauthenticated and failing endpoints expose no provider details and perform no fallback request', async () => {
  for (const status of [401, 403, 503, 502]) {
    let requests = 0, parsed = 0;
    await withFetch(async () => {
      requests++;
      return { ok: false, status, json: async () => { parsed++; return { error: 'synthetic-private-detail' }; } } as Response;
    }, async () => {
      await assert.rejects(AiService.extractInvoice(IMAGE), error => error instanceof Error && error.message === FRIENDLY);
      assert.equal(requests, 1);
      assert.equal(parsed, 0);
    });
  }
});

test('network and JSON failures stay manual-entry errors without leaking the raw error', async () => {
  for (const mode of ['network', 'json'] as const) {
    let requests = 0;
    await withFetch(async () => {
      requests++;
      if (mode === 'network') throw new Error('synthetic-private-detail');
      return { ok: true, json: async () => { throw new Error('synthetic-private-detail'); } } as unknown as Response;
    }, async () => {
      await assert.rejects(AiService.extractInvoice(IMAGE), error => error instanceof Error && error.message === FRIENDLY);
      assert.equal(requests, 1);
    });
  }
});
