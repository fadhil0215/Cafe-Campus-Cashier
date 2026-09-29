const base = process.argv[2] || 'http://127.0.0.1:4176';
const checks = [
  ['/api/health', r => r.ok],
  ['/', async r => r.ok && (await r.text()).includes('Cafe Campus')],
  ['/api/public/settings', async r => r.ok && (await r.json()).taxPercent !== undefined],
  ['/api/public/products', async r => r.ok && Array.isArray(await r.json())],
  ['/api/public/tables/demo-table-01', async r => r.ok && (await r.json()).tableNumber === '01'],
  ['/qr/demo-table-01.svg', async r => r.ok && (r.headers.get('content-type')||'').includes('image/svg+xml')],
];

let failed = false;
for (const [path, verify] of checks) {
  try {
    const r = await fetch(base + path, { cache: 'no-store' });
    const ok = await verify(r);
    if (!ok) {
      console.error(`❌ Check failed on ${path}`);
      failed = true;
      break;
    }
  } catch (err) {
    console.error(`❌ Request failed on ${path}:`, err.message);
    failed = true;
    break;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('✅ Cafe Campus demo smoke-check OK');
}
