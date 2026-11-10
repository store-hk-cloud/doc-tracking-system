import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appUrl = new URL('../desktop/app.js', import.meta.url);

test('desktop receipt draft keeps one batch ID and the original recipient versions for retry', async () => {
  const { makeReceiptDraft } = await import(appUrl);
  const rows = [{ recipient_id: 'doc-a', updated_at: 'revision-a' }];
  const draft = makeReceiptDraft(rows, ' ผู้รับ ', () => 'batch-a');
  rows[0].updated_at = 'revision-b';
  assert.deepEqual(draft, {
    batchId: 'batch-a',
    items: [{ recipientId: 'doc-a', expectedUpdatedAt: 'revision-a' }],
    signatureName: 'ผู้รับ',
  });
  assert.throws(() => makeReceiptDraft([], 'ผู้รับ'), RangeError);
  assert.throws(() => makeReceiptDraft(Array(51).fill(rows[0]), 'ผู้รับ'), RangeError);
  assert.throws(() => makeReceiptDraft(rows, ' '), RangeError);
});

test('desktop locks queued revisions and reports the three distinct outcomes', async () => {
  const { countBatchItems, unavailableReceipts } = await import(appUrl);
  const batch = { items: [
    { recipient_id: 'a', expected_updated_at: 'old', status: 'queued' },
    { recipient_id: 'b', expected_updated_at: 'done', status: 'succeeded' },
    { recipient_id: 'c', expected_updated_at: 'failed', status: 'failed' },
  ] };
  assert.deepEqual(countBatchItems(batch), { queued: 1, succeeded: 1, failed: 1 });
  const blocked = unavailableReceipts([batch]);
  assert.equal(blocked('a', 'old'), true);
  assert.equal(blocked('a', 'new'), false);
  assert.equal(blocked('b', 'done'), true);
  assert.equal(blocked('c', 'failed'), false);
});

test('desktop entry bundles the app and design system without remote dependencies', async () => {
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="th"/);
  assert.match(html, /href="\.\/ui-kit\.css"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  assert.match(html, /id="queue-status"[^>]*role="status"/);
});

test('desktop refresh keeps unrelated selected revisions when any queued receipt finishes', async () => {
  const { finishedReceipt, matchingSelection } = await import(appUrl);
  const item = { recipient_id: 'a', expected_updated_at: 'r1', status: 'queued' };
  const ongoing = { ...item, recipient_id: 'b' };
  const previous = [{ items: [item, ongoing] }];
  assert.equal(finishedReceipt(previous, [{ items: [{ ...item, status: 'failed' }, ongoing] }]), true);
  assert.equal(finishedReceipt(previous, [{ items: [{ ...item, status: 'succeeded' }, ongoing] }]), true);
  assert.equal(finishedReceipt(previous, previous), false);
  assert.deepEqual(matchingSelection([
    { recipient_id: 'a', updated_at: 'r1' }, { recipient_id: 'b', updated_at: 'r1' },
  ], [
    { recipient_id: 'a', updated_at: 'r2' }, { recipient_id: 'b', updated_at: 'r1' },
  ], new Set(['a', 'b'])), ['b']);
});
