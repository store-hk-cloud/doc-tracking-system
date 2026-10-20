# Sheet Sync Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ป้องกันแถว Google Sheets ซ้ำหรือสถานะเก่าทับสถานะใหม่ระหว่างการซิงก์และการซ่อมข้อมูล พร้อมทำให้การตรวจซ่อมรายงานความผิดปกติได้ตรวจสอบย้อนหลัง

**Architecture:** ให้ Google Sheets เป็นกระจกข้อมูลของ Supabase เท่านั้น โดยรหัสอ้างอิง `document_recipients.id` เป็นตัวตนของแถวทุกครั้ง การซิงก์ปกติเรียงงานของรหัสเดียวกันใน instance เดียว และงาน backfill ถือ lease ใน Supabase ตลอดช่วง snapshot ถึง write เพื่อกัน race ข้าม Vercel instance งานซ่อมจะอ่านแท็บรายวันเป็นชุด เพื่อลดโควตา Google Sheets และตรวจแถวซ้ำก่อนกล่าวว่าข้อมูลครบ

**Tech Stack:** Next.js 15 API Routes, TypeScript, Supabase Postgres/RPC, Google Sheets API, Node built-in tests

**Spec:** การแจ้งฝ่ายบัญชีเรื่องเอกสารที่ลงนามแล้วกลับมาอยู่ในคิว และคำขอให้ตรวจ/ซ่อมการเขียน Google Sheets ให้ครบถ้วน

## Global Constraints

- ใช้ Supabase และ Vercel แพ็กเกจฟรีเดิม; ห้ามเพิ่มบริการหรือ dependency ใหม่
- Supabase เป็นแหล่งข้อมูลจริง; Sheets ต้องไม่เขียนย้อนฐานข้อมูล
- เก็บแท็บ `_conflict` เป็นหลักฐานเดิมและห้ามลบอัตโนมัติ
- งานเขียน Sheet ต้องใช้ `RAW` และแท็บปลายทางต้องเป็นวันที่ ISO เท่านั้น
- ทุก behavior ใหม่ต้องมี regression test ที่เห็น fail ก่อนเขียน production code

---

### Task 1: Serialize a recipient's in-process Sheet write

**Files:**
- Modify: `src/lib/google-sheets.ts`
- Test: `scripts/test-google-sheets-sync.test.mjs`

**Interfaces:**
- Consumes: `syncRowInSheet(preferredSheet: string, values: string[])`
- Produces: keyed promise queue keyed by `values[20]` (`document_recipients.id`)

- [ ] **Step 1: Write the failing test**

```js
await Promise.all([
  sheets.syncRowInSheet('2026-09-03', deliveredValues),
  sheets.syncRowInSheet('2026-09-03', closedValues),
]);
assert.equal(appendCalls.length, 1);
assert.equal(updateCalls[0].requestBody.values[0][6], 'closed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test-google-sheets-sync.test.mjs`
Expected: `appendCalls.length` is `2` before serialization.

- [ ] **Step 3: Write minimal implementation**

```ts
const rowSyncQueues = new Map<string, Promise<void>>();
// Queue one lookup → update/append operation per recipient reference.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/test-google-sheets-sync.test.mjs`
Expected: one append then one update, with the newest queued values.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-sheets.ts scripts/test-google-sheets-sync.test.mjs
git commit -m "fix: serialize Sheet writes for one recipient"
```

### Task 2: Hold a durable lease around the complete backfill

**Files:**
- Create: `supabase/migrations/20260909105103_serialize_sheets_backfill.sql`
- Modify: `src/app/api/admin/backfill-sheets/route.ts`
- Test: `scripts/test-sheet-backfill.test.mjs`

**Interfaces:**
- Consumes: `try_acquire_sheet_backfill_lock(p_token uuid) returns boolean`
- Produces: `release_sheet_backfill_lock(p_token uuid) returns boolean`

- [ ] **Step 1: Write the failing test**

```js
const response = await fixture({ locked: true }).route.GET();
assert.equal(response.status, 409);
assert.deepEqual(calls.normalized, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test-sheet-backfill.test.mjs`
Expected: the old route returns `200` and proves no durable lock existed.

- [ ] **Step 3: Write minimal implementation**

```sql
INSERT INTO public.maintenance_locks AS locks (name, token, expires_at)
VALUES ('sheet_backfill', p_token, statement_timestamp() + interval '20 minutes')
ON CONFLICT (name) DO UPDATE ... WHERE locks.expires_at <= statement_timestamp();
```

Wrap the endpoint snapshot and all writes in `try/finally`, returning `409` before touching Sheets if the lease is held.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/test-sheet-backfill.test.mjs && npm run typecheck`
Expected: locked run is refused; normal repair still succeeds.

- [ ] **Step 5: Verify migration security and behavior**

Run a service-role query that acquires, rejects a second token, releases, reacquires, and cleans up. Confirm `maintenance_locks` has RLS, `anon`/`authenticated` have no table write privilege, and only `service_role` has function execute permission.

### Task 3: Reduce backfill read quota and expose duplicate evidence

**Files:**
- Modify: `src/lib/google-sheets.ts`
- Modify: `src/app/api/admin/backfill-sheets/route.ts`
- Test: `scripts/test-google-sheets-sync.test.mjs`
- Test: `scripts/test-sheet-backfill.test.mjs`

**Interfaces:**
- Consumes: `getSheetValuesBatch(sheetNames: string[])`
- Produces: `Map<string, string[][]>` with one entry per requested ISO-date tab

- [ ] **Step 1: Write failing tests**

```js
const rows = await sheets.getSheetValuesBatch(['2026-09-03', '2026-09-05']);
assert.equal(batchGetCalls.length, 1);
assert.deepEqual(rows.get('2026-09-05'), expectedRows);
```

Also assert a pre-existing duplicate recipient reference is returned in a `duplicateReferences` count rather than a clean result.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test scripts/test-google-sheets-sync.test.mjs scripts/test-sheet-backfill.test.mjs`
Expected: missing bulk reader/duplicate report causes the new tests to fail.

- [ ] **Step 3: Write minimal implementation**

```ts
const response = await sheets.spreadsheets.values.batchGet({
  spreadsheetId,
  ranges: names.map((name) => `${name}!A:U`),
});
```

Use chunks of at most 100 ranges; preserve the requested name as the `Map` key. Count only canonical rows whose reference and expected running number agree; leave duplicate/conflict evidence untouched.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test scripts/test-google-sheets-sync.test.mjs scripts/test-sheet-backfill.test.mjs`
Expected: batch reader makes one request per chunk and duplicate evidence is returned without destructive writes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-sheets.ts src/app/api/admin/backfill-sheets/route.ts scripts/test-*.test.mjs supabase/migrations
git commit -m "fix: make Sheet reconciliation serialized and auditable"
```

### Task 4: Run live reconciliation and release verification

**Files:**
- Modify: `docs/` only if recording a deployment result is already an established project practice

**Interfaces:**
- Consumes: authenticated super-admin access to `/api/admin/backfill-sheets`
- Produces: exact `updated`, `appended`, and `duplicateReferences` result plus verified canonical tabs

- [ ] **Step 1: Run all local release checks**

Run: `npm run lint && npm test && npm run build && npm run typecheck && git diff --check`
Expected: zero failures and no whitespace error.

- [ ] **Step 2: Deploy after database migration is verified**

Run: `git push origin master`, then `npx vercel --prod --yes` only if Git deployment is not already READY.

- [ ] **Step 3: Run one authenticated backfill**

Open `/api/admin/backfill-sheets` as super admin exactly once. Record response counts; if `duplicateReferences > 0`, preserve rows and report their references for controlled follow-up rather than deleting them.

- [ ] **Step 4: Re-read canonical Sheet cells and compare against Supabase**

Verify header rows, reference column U, and signed rows from the accounting date range. Confirm closed rows are still closed in both sources.

- [ ] **Step 5: Inspect production deployment**

Run: `npx vercel inspect <deployment-url>` and `npx vercel logs <deployment-url> --level error --since 1h`.

## Self-Review

- Spec coverage: Tasks 1–2 close the two confirmed races; Task 3 prevents quota-driven incomplete reconciliation and reports duplicate evidence; Task 4 repairs and verifies live state.
- Placeholder scan: no unresolved implementation names or file locations remain.
- Type consistency: all write paths retain `values[20]` as recipient reference and canonical ISO date tabs.

## Execution Handoff

ผู้ใช้สั่งให้ดำเนินการต่อ จึงเลือก Inline Execution ใน session นี้ โดยจะทำตามลำดับ Task 3 และ Task 4 หลัง Task 1–2 ที่ดำเนินการแล้ว.
