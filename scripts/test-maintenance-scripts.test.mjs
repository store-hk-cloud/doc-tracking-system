import assert from 'node:assert/strict';
import test from 'node:test';
import { setEnvironment } from './set-env.mjs';
import { runSchema } from './run-schema.mjs';

test('environment values never become shell commands and invalid names are rejected', () => {
  const secret = 'x"; $(bad-command) & more\nsecond-line';
  for (const platform of ['win32', 'linux']) {
    setEnvironment('TEST_KEY', secret, (command, args, options) => {
      assert.ok(!args.join(' ').includes(secret));
      assert.equal(options.input, secret);
      assert.notEqual(options.shell, true);
      return { status: 0 };
    }, platform);
  }
  assert.throws(() => setEnvironment('KEY;command', 'value', () => assert.fail('Must not execute')));
});

test('failed environment update does not run an unsafe fallback or report success', () => {
  let calls = 0;
  assert.throws(() => setEnvironment('TEST_KEY', 'secret', () => { calls++; return { status: 1 }; }));
  assert.equal(calls, 1);
});

test('schema setup uses one transaction and rolls back failures without live database access', async () => {
  for (const fail of [false, true]) {
    const commands = [];
    class FakeClient {
      async connect() { commands.push('connect'); }
      async query(sql) { commands.push(sql); if (fail && sql.includes('CREATE TABLE')) throw new Error('DDL failed'); }
      async end() { commands.push('end'); }
    }
    if (fail) await assert.rejects(runSchema('postgres://test', FakeClient), /DDL failed/);
    else await runSchema('postgres://test', FakeClient);
    assert.equal(commands[1], 'BEGIN');
    assert.equal(commands.at(-2), fail ? 'ROLLBACK' : 'COMMIT');
    assert.equal(commands.at(-1), 'end');
  }
  await assert.rejects(runSchema(''), /required/);
});
