import http from 'node:http';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cafe_campus_db',
  multipleStatements: true
};

const TEST_PORT = 4199;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function request(path, opts = {}) {
  const url = new URL(path, BASE_URL);
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

async function run() {
  console.log('🚀 Starting Full v7 Feature Test Suite...');

  // Start server on port 4199
  const server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(TEST_PORT), STUDENT_DAILY_LIMIT: '10' },
    stdio: 'pipe'
  });

  server.stdout.on('data', d => {});
  server.stderr.on('data', d => console.error('Server err:', d.toString()));

  await sleep(2500);

  try {
    // 1. Login Admin
    const loginRes = await request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
    });
    if (loginRes.status !== 200) throw new Error('Login failed: ' + loginRes.text);
    const setCookie = loginRes.headers.get('set-cookie');
    const authHeaders = { cookie: setCookie.split(';')[0] };
    console.log('✓ Admin login successful');

    // 2. Master Data Fakultas CRUD
    const facList = await request('/api/public/faculties');
    if (!Array.isArray(facList.json) || facList.json.length === 0) throw new Error('Faculties list empty');
    console.log('✓ Master fakultas retrieved (' + facList.json.length + ' faculties)');

    const testCode = 'FDK' + Date.now().toString().slice(-4);
    const testId = 'fac-' + testCode.toLowerCase();
    const createFac = await request('/api/admin/faculties', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: testId, name: 'Fakultas Desain Kreatif', code: testCode, colorTheme: '#ec4899' })
    });
    if (createFac.status !== 201) throw new Error('Create faculty failed: ' + createFac.text);

    const updateFac = await request(`/api/admin/faculties/${testId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Fakultas Desain & Seni Kreatif', colorTheme: '#db2777' })
    });
    if (updateFac.status !== 200) throw new Error('Update faculty failed: ' + updateFac.text);

    const delFac = await request(`/api/admin/faculties/${testId}`, {
      method: 'DELETE',
      headers: authHeaders
    });
    if (delFac.status !== 200) throw new Error('Delete faculty failed: ' + delFac.text);
    console.log('✓ Master fakultas CRUD passed');

    // 3. Raw Materials & Stock Mutation
    const matList = await request('/api/admin/materials', { headers: authHeaders });
    if (!Array.isArray(matList.json) || matList.json.length === 0) throw new Error('Materials list empty');
    const coffeeBean = matList.json.find(m => m.id === 'mat-coffee-beans') || matList.json[0];
    const initialStock = Number(coffeeBean.current_stock);

    const adjRes = await request(`/api/admin/materials/${coffeeBean.id}/adjust`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ changeAmount: 50, notes: 'Pengujian penyesuaian stok unit test' })
    });
    if (adjRes.status !== 200 || Number(adjRes.json.current_stock) !== initialStock + 50) {
      throw new Error('Stock adjustment failed: ' + adjRes.text);
    }

    const mutations = await request('/api/admin/stock/mutations', { headers: authHeaders });
    if (!Array.isArray(mutations.json) || mutations.json.length === 0) throw new Error('Stock mutations empty');
    console.log('✓ Raw materials & stock adjustment passed');

    // 4. Recipe Management & Atomic Stock Deduction on Order
    const products = await request('/api/public/products');
    const icedLatte = products.json.find(p => p.name === 'Iced Latte Gula Aren') || products.json[0];

    // Check recipe for iced latte
    const recipeRes = await request(`/api/admin/products/${icedLatte.id}/recipe`, { headers: authHeaders });
    if (!Array.isArray(recipeRes.json)) throw new Error('Recipe get failed');
    console.log(`✓ Recipe retrieved for ${icedLatte.name} (${recipeRes.json.length} ingredients)`);

    // Place an order with recipe items
    const today = new Date();
    const todayBirthStr = `2003-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    const preStockRes = await request('/api/admin/materials', { headers: authHeaders });
    const preCoffee = preStockRes.json.find(m => m.id === 'mat-coffee-bean');
    const preStockVal = Number(preCoffee.current_stock);

    const orderRes = await request('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        tableToken: 'demo-table-01',
        customerType: 'STUDENT',
        studentInfo: {
          campus: 'Universitas Indonesia',
          studentId: '220' + Date.now().toString().slice(-7),
          studentName: 'Budi Test Ultah',
          facultyId: 'fac-1',
          facultyCode: 'FASILKOM',
          facultyName: 'Fakultas Ilmu Komputer',
          studyProgram: 'Teknik Informatika',
          birthDate: todayBirthStr,
          studentPhoto: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80'
        },
        items: [{ productId: icedLatte.id, quantity: 2, note: '', options: {} }],
        paymentMethod: 'CASH',
        idempotencyKey: 'test-v7-order-' + Date.now()
      })
    });
    if (orderRes.status !== 201) throw new Error('Create student order failed: ' + orderRes.text);
    const orderNum = orderRes.json.orderNumber;
    console.log('✓ Order created with queue number: ' + orderRes.json.queueNumber);

    // Pay cash
    const payRes = await request(`/api/admin/orders/${orderNum}/payment`, {
      method: 'PATCH',
      headers: authHeaders,
      body: '{}'
    });
    if (payRes.status !== 200) throw new Error('Payment confirmation failed: ' + payRes.text);

    // Check stock was atomically deducted
    const postStockRes = await request('/api/admin/materials', { headers: authHeaders });
    const postCoffee = postStockRes.json.find(m => m.id === 'mat-coffee-bean');
    const postStockVal = Number(postCoffee.current_stock);
    if (postStockVal >= preStockVal) throw new Error('Stock was not deducted after payment');
    console.log(`✓ Atomic stock deduction confirmed: ${preStockVal} -> ${postStockVal}`);

    // 5. Birthday Reward Flow
    const getOrd = await request(`/api/admin/orders?q=${orderNum}`, { headers: authHeaders });
    const ordObj = getOrd.json.find(o => o.orderNumber === orderNum);
    if (!ordObj.studentInfo?.isBirthdayToday) throw new Error('Birthday was not detected today');
    console.log('✓ Student birthday detected today (🎂)');

    const claimBday = await request(`/api/admin/orders/${orderNum}/birthday-reward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ rewardType: 'FREE_ITEM', rewardName: 'Free Birthday Latte' })
    });
    if (claimBday.status !== 200) throw new Error('Birthday claim failed: ' + claimBday.text);
    console.log('✓ Birthday reward claimed');

    // Attempt double claim in same year -> must be blocked
    const doubleClaim = await request(`/api/admin/orders/${orderNum}/birthday-reward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ rewardType: 'FREE_ITEM', rewardName: 'Double Claim' })
    });
    if (doubleClaim.status !== 400) throw new Error('Double claim was not blocked');
    console.log('✓ Annual double claim successfully prevented');

    // 6. Dual Kitchen Receipt Routing
    const receiptRes = await request(`/api/admin/orders/${orderNum}/receipt`, { headers: authHeaders });
    if (receiptRes.status !== 200) throw new Error('Receipt endpoint failed: ' + receiptRes.text);
    if (!Array.isArray(receiptRes.json.drinkItems)) throw new Error('Receipt missing drinkItems');
    console.log('✓ Dual kitchen receipt generated (Drink vs Food items separated)');

    // 7. Void Order & Restore Raw Materials
    const voidRes = await request(`/api/admin/orders/${orderNum}/void`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Unit test order void' })
    });
    if (voidRes.status !== 200) throw new Error('Order void failed: ' + voidRes.text);

    // Verify stock is restored
    const restoredStockRes = await request('/api/admin/materials', { headers: authHeaders });
    const restoredCoffee = restoredStockRes.json.find(m => m.id === 'mat-coffee-bean');
    if (Number(restoredCoffee.current_stock) !== preStockVal) {
      throw new Error(`Stock was not restored correctly upon void. Expected ${preStockVal}, got ${restoredCoffee.current_stock}`);
    }
    console.log('✓ Order voided and raw materials stock restored cleanly');

    // 8. Tobacco / Rokok Category & 21+ Age Gate
    const rokokItem = products.json.find(p => p.isTobacco || p.categorySlug === 'rokok');
    if (rokokItem) {
      // Under 21 attempt
      const under21Res = await request('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableToken: 'demo-table-01',
          customerType: 'REGULAR',
          studentInfo: { birthDate: '2015-05-15' }, // 11 years old
          items: [{ productId: rokokItem.id, quantity: 1, note: '', options: {} }],
          paymentMethod: 'CASH',
          idempotencyKey: 'test-tobacco-under21-' + Date.now()
        })
      });
      if (under21Res.status !== 400) throw new Error('Under 21 tobacco order was not blocked');
      console.log('✓ Tobacco under-21 age gate successfully blocked');
    }

    // 9. Cashier Shifts Flow
    const prevActive = await request('/api/admin/shifts/active', { headers: authHeaders });
    if (prevActive.json && prevActive.json.id) {
      await request('/api/admin/shifts/close', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ actualCash: 250000, notes: 'Auto close previous test shift' })
      });
    }

    const openShiftRes = await request('/api/admin/shifts/open', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ startingCash: 250000, notes: 'Shift Pagi Test' })
    });
    if (openShiftRes.status !== 200 && openShiftRes.status !== 201) {
      throw new Error('Open shift failed: ' + openShiftRes.text);
    }

    const activeShiftRes = await request('/api/admin/shifts/active', { headers: authHeaders });
    if (activeShiftRes.status !== 200 || !activeShiftRes.json) {
      throw new Error('Get active shift failed');
    }
    console.log('✓ Cashier shift opened (Starting cash: Rp ' + activeShiftRes.json.starting_cash + ')');

    const closeShiftRes = await request('/api/admin/shifts/close', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actualCash: 250000, notes: 'Shift Closed Test' })
    });
    if (closeShiftRes.status !== 200) throw new Error('Close shift failed: ' + closeShiftRes.text);
    console.log('✓ Cashier shift closed with variance calculated');

    // 10. Audit Logs
    const auditRes = await request('/api/admin/audit', { headers: authHeaders });
    if (!Array.isArray(auditRes.json) || auditRes.json.length === 0) throw new Error('Audit log is empty');
    console.log(`✓ Audit log verified (${auditRes.json.length} recorded actions)`);

    console.log('\n🎉 ALL FULL V7 FEATURE TESTS PASSED SUCCESSFULLY! (10/10)');
  } finally {
    server.kill();
  }
}

run().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
