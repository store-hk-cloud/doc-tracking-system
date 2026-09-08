import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('legacy RLS SQL fails closed rather than reinstalling permissive policies', async () => {
  const db = new PGlite();
  try {
    await assert.rejects(db.exec(readFileSync('scripts/fix-rls-recursion.sql', 'utf8')), /Retired unsafe RLS script/);
    const source = readFileSync('scripts/apply-rls-fix.mjs', 'utf8');
    assert.match(source, /20260908013649_database_security_lockdown\.sql/);
    assert.doesNotMatch(source, /\.split\(';'/);
  } finally { await db.close(); }
});

test('maintenance scripts do not disable certificate verification in source', () => {
  for (const file of readdirSync('scripts').filter((name) => name.endsWith('.mjs') && !name.startsWith('test-'))) {
    const source = readFileSync(`scripts/${file}`, 'utf8');
    assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false|sslmode=disable/, file);
  }
});
