const base = process.argv[2] || 'http://127.0.0.1:4176';
const checks = [
  ['/api/health', r => r.ok],
  ['/', async r => r.ok && (await r.text()).includes('Cafe Campus')],
  ['/api/public/settings', async r => r.ok && (await r.json()).demoMode === true],
  ['/api/public/products', async r => r.ok && Array.isArray(await r.json())],
  ['/api/public/tables/demo-table-01', async r => r.ok && (await r.json()).tableNumber === '01'],
  ['/qr/demo-table-01.svg', async r => r.ok && (r.headers.get('content-type')||'').includes('image/svg+xml')],
];
for (const [path, verify] of checks) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(base + path, { signal: ctrl.signal, cache: 'no-store' });
    if (!(await verify(r))) process.exit(2);
  } catch { process.exit(3); }
  finally { clearTimeout(t); }
}
console.log('Cafe Campus demo smoke-check OK');
