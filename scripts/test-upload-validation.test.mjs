import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function fakeFile(bytes, { name = 'หลักฐาน.jpg', type = 'image/jpeg' } = {}) {
  const buffer = Buffer.from(bytes);
  return {
    name,
    type,
    size: buffer.length,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

function requestWith(fields) {
  return {
    formData: async () => ({ get: (name) => fields[name] ?? null }),
  };
}

function isoFileType(majorBrand, compatibleBrands) {
  const bytes = Buffer.alloc(16 + compatibleBrands.length * 4);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write(majorBrand, 8, 'ascii');
  for (const [index, brand] of compatibleBrands.entries()) bytes.write(brand, 16 + index * 4, 'ascii');
  return bytes;
}

test('image validator accepts only matching allowed MIME types and recognized image bytes', () => {
  const image = loadModule('src/lib/image-validation.ts');
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const cases = [
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['image/webp', Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary'), 'image/webp'],
    ['image/heic', isoFileType('mif1', ['mif1', 'heic']), 'image/heic'],
    ['image/heic', isoFileType('heic', ['mif1']), 'image/heic'],
    ['image/heic', isoFileType('heic', []), 'image/heic'],
    ['image/heif', isoFileType('mif1', ['mif1']), 'image/heif'],
  ];

  for (const [declaredType, bytes, expectedType] of cases) {
    assert.deepEqual(plain(image.validateImageContent(declaredType, bytes)), { ok: true, mimeType: expectedType });
  }
  assert.deepEqual(plain(image.validateImageContent('image/png', Buffer.from([0xff, 0xd8, 0xff]))), {
    ok: false,
    error: 'ชนิดไฟล์ไม่ตรงกับเนื้อหาไฟล์รูป',
  });
  assert.deepEqual(plain(image.validateImageContent('image/jpeg', Buffer.from('<script>alert(1)</script>'))), {
    ok: false,
    error: 'อัปโหลดได้เฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, HEIC)',
  });
});

test('damage upload rejects non-image bytes that claim to be JPEG', async () => {
  const route = loadModule('src/app/api/upload/route.ts', {
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ response: null }) },
    '@/lib/supabase-storage': { uploadImage: async () => 'https://example.invalid/unsafe.jpg' },
  }, { Buffer });

  const response = await route.POST(requestWith({
    file: fakeFile('<script>alert(1)</script>'),
  }));

  assert.equal(response.status, 415);
});

test('Drive upload rejects non-image bytes that claim to be JPEG', async () => {
  const route = loadModule('src/app/api/upload-to-drive/route.ts', {
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ response: null }) },
    '@/lib/google-drive': { uploadToDrive: async () => ({ fileId: 'unsafe', viewLink: 'https://example.invalid/unsafe' }) },
  }, { Buffer });

  const response = await route.POST(requestWith({
    file: fakeFile('<script>alert(1)</script>'),
    folder: 'documents',
  }));

  assert.equal(response.status, 415);
});

test('messenger evidence upload rejects non-image bytes that claim to be JPEG', async () => {
  const job = { id: 'job-1', status: 'open', assigned_to: 'messenger-1', created_by: 'admin-1' };
  const supabase = {
    from(table) {
      let operation = 'select';
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        insert() { operation = 'insert'; return query; },
        async single() {
          if (table === 'messenger_jobs') return { data: job, error: null };
          if (table === 'messenger_job_photos' && operation === 'insert') return { data: { id: 'photo-1' }, error: null };
          return { data: null, error: null };
        },
        async maybeSingle() { return { data: null, error: null }; },
      };
      return query;
    },
  };
  const route = loadModule('src/app/api/messenger/runs/[id]/photos/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
    '@/lib/supabase/auth-helpers': { requireCapability: async () => ({
      response: null,
      context: { user: { id: 'messenger-1', email: 'messenger@example.invalid' }, profile: {} },
    }), forbiddenResponse: () => Response.json({ success: false }, { status: 403 }) },
    '@/lib/permissions': { canUploadEvidence: async () => true, canSeeJob: async () => true },
    '@/lib/messenger-audit': { appendAudit: async () => {}, getActorName: async () => 'ผู้ทดสอบ' },
    '@/lib/google-drive': { uploadToDrive: async () => ({ fileId: 'unsafe', viewLink: 'https://example.invalid/unsafe' }) },
    crypto: { createHash: () => ({ update: () => ({ digest: () => 'a'.repeat(64) }) }) },
  }, { Buffer });

  const response = await route.POST(requestWith({
    file: fakeFile('<script>alert(1)</script>'),
    photo_kind: 'cash_envelope',
  }), { params: Promise.resolve({ id: 'job-1' }) });

  assert.equal(response.status, 415);
});
