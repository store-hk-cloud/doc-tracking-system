import https from 'https';

const data = JSON.stringify({
  email: 'store-hk@hillkoff.com',
  password: 'Admin@123456',
  full_name: 'Admin'
});

const opts = {
  hostname: 'doc-tracking-system-three.vercel.app',
  path: '/api/setup-admin',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(opts, (res) => {
  let d = '';
  res.on('data', (c) => d += c);
  res.on('end', () => console.log('✅', d));
});
req.on('error', (e) => console.log('❌', e.message));
req.write(data);
req.end();