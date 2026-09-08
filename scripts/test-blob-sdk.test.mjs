import assert from 'node:assert/strict';
import test from 'node:test';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { loadModule } from './test-support/load-module.mjs';

test('Blob SDK sends a uniquely named public image and returns its URL without contacting a live store', async () => {
  const oldDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_testsecret';
  let headers;
  const url = 'https://teststore.public.blob.vercel-storage.com/damage/image-random.jpg';
  agent.get('https://vercel.com').intercept({ path: /\/api\/blob.*/, method: 'PUT' }).reply((options) => {
    headers = options.headers;
    return { statusCode: 200, data: JSON.stringify({ url, downloadUrl: url, pathname: 'damage/image-random.jpg', contentType: 'image/jpeg', contentDisposition: 'inline' }), responseOptions: { headers: { 'content-type': 'application/json' } } };
  });
  try {
    const blob = loadModule('src/lib/vercel-blob.ts');
    assert.equal(await blob.uploadImage('damage/image.jpg', Buffer.from('test image')), url);
    const requestHeaders = new Headers(headers);
    assert.equal(requestHeaders.get('x-add-random-suffix'), '1');
    agent.assertNoPendingInterceptors();
  } finally {
    if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    setGlobalDispatcher(oldDispatcher);
    await agent.close();
  }
});
