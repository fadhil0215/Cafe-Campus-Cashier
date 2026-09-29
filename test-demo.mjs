import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const PORT=4188, host=`http://127.0.0.1:${PORT}`, base=`${host}/api`;
const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let cookie='';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,{method='GET',body,admin=false,expect=200}={}){const h={'Content-Type':'application/json'};if(admin&&cookie)h.Cookie=cookie;const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];let d={};try{d=await r.json()}catch{}assert.equal(r.status,expect,`${method} ${path}: expected ${expect}, got ${r.status} ${JSON.stringify(d)}`);return d}
async function wait(){for(let i=0;i<50;i++){try{const r=await fetch(base+'/health');if(r.ok)return}catch{}await sleep(100)}throw new Error('Demo server tidak start')}
const run=Date.now().toString(36);const checks=[];const ok=name=>{checks.push(name);console.log('✓',name)};
try{
 await wait();assert.equal((await call('/health')).ok,true);ok('Health check');
 let rr=await fetch(host+'/');assert.equal(rr.status,200);assert.match(await rr.text(),/Cafe Campus/);ok('Figma review landing served');
 for(const path of ['/order/demo-table-12','/order/demo-table-12/menu','/order/demo-table-12/product/example','/cart','/checkout','/track/example','/admin/login','/admin','/admin/orders','/admin/menu','/admin/categories','/admin/tables','/admin/payments','/admin/reports','/admin/settings']){rr=await fetch(host+path);assert.equal(rr.status,200,path)}ok('All SPA routes served');
 for(const asset of ['/assets/hero-mobile.jpg','/assets/hero-desktop.jpg','/assets/iced-latte.jpg','/assets/croissant.jpg','/assets/matcha.jpg','/assets/waffle.jpg']){rr=await fetch(host+asset);assert.equal(rr.status,200,asset);assert.match(rr.headers.get('content-type')||'',/image\/jpeg/)}ok('Figma-derived visual assets served with JPEG MIME');
 await call('/admin/dashboard',{expect:401});ok('Admin API protected');
 await call('/events?channel=admin',{expect:401});ok('Admin realtime stream protected');
 await call('/public/tables/not-valid',{expect:404});ok('Invalid QR rejected');
 const table=await call('/public/tables/demo-table-12');assert.equal(table.name,'Meja 12');ok('Valid QR resolves correct table');
 rr=await fetch(host+'/qr/demo-table-12.svg');assert.equal(rr.status,200);assert.match(rr.headers.get('content-type')||'',/image\/svg\+xml/);assert.ok((await rr.text()).length>500);ok('Dynamic table QR generated');
 const settings=await call('/public/settings');assert.equal(settings.demoMode,true);assert.equal(settings.serviceFee,5);assert.equal(settings.taxPercent,11);assert.equal(settings.qrisEnabled,true);assert.equal(settings.cashEnabled,true);ok('Public checkout configuration matches design');
 const products=await call('/public/products');const available=products.filter(p=>p.isAvailable),sold=products.find(p=>!p.isAvailable),iced=products.find(p=>p.name==='Iced Latte Gula Aren');assert.ok(available.length>=5&&sold&&iced?.customizable);assert.equal(iced.price,28000);assert.equal(iced.studentPrice,22000);ok('Catalog, dual student pricing, sold-out and customizable drink seed');
 await call('/orders',{method:'POST',body:{tableToken:'demo-table-12',items:[{productId:sold.id,quantity:1}],paymentMethod:'CASH',idempotencyKey:'sold-'+run},expect:409});ok('Sold-out product blocked server-side');
 
 // Regular customer order test
 const regularPayload={tableToken:'demo-table-12',customerType:'REGULAR',items:[{productId:iced.id,quantity:2,note:'Espresso extra light',options:{size:'Large',sweetness:'Less',ice:'Sedikit Es'}}],paymentMethod:'CASH',idempotencyKey:'reg-'+run};
 const regOrder=await call('/orders',{method:'POST',body:regularPayload,expect:201});const regFull=await call('/orders/'+regOrder.orderNumber+'?access='+encodeURIComponent(regOrder.accessToken));assert.equal(regFull.customerType,'REGULAR');assert.equal(regFull.items[0].price,33000);assert.equal(regFull.items[0].regularPrice,33000);assert.equal(regFull.totalSavings,0);assert.equal(regFull.subtotal,66000);ok('Regular customer priced at standard rate');

  // 1. Edu Email OTP verification tests
  await call('/public/student/send-otp',{method:'POST',body:{email:'fraudster@gmail.com'},expect:400});ok('Non-edu email domain rejected for student verification');
  const otpRes=await call('/public/student/send-otp',{method:'POST',body:{email:'rian.ardiansyah@ui.ac.id'},expect:200});assert.ok(otpRes.demoOtp);ok('Official campus .ac.id email generates OTP');
  await call('/public/student/verify-otp',{method:'POST',body:{email:'rian.ardiansyah@ui.ac.id',code:'0000'},expect:400});ok('Invalid OTP rejected');
  const vOtpRes=await call('/public/student/verify-otp',{method:'POST',body:{email:'rian.ardiansyah@ui.ac.id',code:otpRes.demoOtp},expect:200});assert.equal(vOtpRes.verified,true);ok('Valid OTP marks campus email verified');  // 2. Student customer order with edu email & selfie photo (AI Auto-evaluation test)
  const studentPayload={tableToken:'demo-table-12',customerType:'STUDENT',studentInfo:{campus:'Universitas Indonesia',studentId:'2306781001',studentName:'Rian Ardiansyah',email:'rian.ardiansyah@ui.ac.id',studentPhoto:'data:image/jpeg;base64,mockselfiephotodata'},items:[{productId:iced.id,quantity:2,note:'Extra sweet',options:{size:'Large',sweetness:'Normal',ice:'Normal'}}],paymentMethod:'CASH',idempotencyKey:'stud-'+run};
  const studOrder=await call('/orders',{method:'POST',body:studentPayload,expect:201});const studFull=await call('/orders/'+studOrder.orderNumber+'?access='+encodeURIComponent(studOrder.accessToken));assert.equal(studFull.customerType,'STUDENT');assert.equal(studFull.studentInfo.campus,'Universitas Indonesia');assert.equal(studFull.studentInfo.studentId,'2306781001');assert.equal(studFull.studentInfo.verificationStatus,'AUTOMATICALLY_VERIFIED');assert.equal(studFull.studentInfo.fraudRisk,'LOW');assert.ok(studFull.studentInfo.studentPhoto.includes('mockselfie'));assert.equal(studFull.items[0].price,27000);assert.equal(studFull.items[0].regularPrice,33000);assert.equal(studFull.items[0].savings,12000);assert.equal(studFull.subtotal,54000);assert.equal(studFull.totalSavings,12000);assert.equal(studFull.total,62937);ok('Student customer order attaches selfie photo & passes AI automatic verification');

  // 3. Anti-Sybil Daily Quota Limit Test (Second order with same NIM blocked today)
  const quotaAbusePayload={tableToken:'demo-table-05',customerType:'STUDENT',studentInfo:{campus:'Universitas Indonesia',studentId:'2306781001',studentName:'Rian Ardiansyah',email:'rian.ardiansyah@ui.ac.id',studentPhoto:'data:image/jpeg;base64,mockselfiephotodata'},items:[{productId:iced.id,quantity:1}],paymentMethod:'CASH',idempotencyKey:'quota-'+run};
  await call('/orders',{method:'POST',body:quotaAbusePayload,expect:409});ok('Anti-Sybil: Daily quota limit blocks 2nd student order with same NIM on same day');

  const duplicate=await call('/orders',{method:'POST',body:studentPayload,expect:201});assert.equal(duplicate.orderNumber,studOrder.orderNumber);ok('Retry/idempotency returns same student order');
  await call('/orders/'+studOrder.orderNumber+'?access=wrong',{expect:403});await call('/events?order='+studOrder.orderNumber+'&access=wrong',{expect:403});ok('Customer order/realtime access token protected');
  await call('/admin/login',{method:'POST',body:{email:'wrong',password:'wrong'},expect:401});await call('/admin/login',{method:'POST',body:{email:'admin@cafecampus.demo',password:'admin123'}});assert.ok(cookie);ok('Admin login + HttpOnly session');
  {const ctrl=new AbortController();const sr=await fetch(base+'/events?channel=admin',{headers:{Cookie:cookie},signal:ctrl.signal});assert.equal(sr.status,200);const rd=sr.body.getReader();const first=await rd.read();assert.match(new TextDecoder().decode(first.value),/event: hello/);ctrl.abort();ok('Authorized admin realtime stream');}
  
  const seeded=await call('/admin/dashboard',{admin:true});assert.ok(seeded.totalOrders>=5);assert.ok(seeded.revenue>0);assert.ok('studentRevenue' in seeded&&'regularRevenue' in seeded);ok('Dashboard has student vs regular revenue split metrics');
  
  // 4. Anti-fraud verification by admin: approve
  let vApproved=await call('/admin/orders/'+studOrder.orderNumber+'/verify-student',{method:'PATCH',admin:true,body:{status:'VERIFIED'}});assert.equal(vApproved.studentInfo.verificationStatus,'VERIFIED');ok('Admin approves student KTM verification');

  // 5. Anti-fraud test: create a suspicious student order (no edu email) and reject it (revert to regular price)
  const fakeStudentPayload={tableToken:'demo-table-02',customerType:'STUDENT',studentInfo:{campus:'Fake College',studentId:'000000',studentName:'Fake User',email:'fake@yahoo.com',studentPhoto:'data:image/jpeg;base64,invalidphoto'},items:[{productId:iced.id,quantity:2,options:{size:'Large'}}],paymentMethod:'CASH',idempotencyKey:'fake-'+run};
  const fakeOrder=await call('/orders',{method:'POST',body:fakeStudentPayload,expect:201});assert.equal(fakeOrder.totalSavings,12000);
  let vRejected=await call('/admin/orders/'+fakeOrder.orderNumber+'/verify-student',{method:'PATCH',admin:true,body:{status:'REJECTED',reason:'Foto selfie bukan kartu mahasiswa'}});
  assert.equal(vRejected.studentInfo.verificationStatus,'REJECTED');
  assert.equal(vRejected.customerType,'REGULAR');
  assert.equal(vRejected.totalSavings,0);
  assert.equal(vRejected.items[0].price,33000);
  assert.equal(vRejected.subtotal,66000);
  assert.equal(vRejected.total,76923);
  ok('Admin rejects fake student KTM and automatically reverts order to regular price');

  // 6. Blacklist API Test
  const blItem=await call('/admin/fraud/blacklist',{method:'POST',admin:true,body:{studentId:'000000',email:'fake@yahoo.com',studentName:'Fake User',reason:'Kecurangan berulang'},expect:201});assert.equal(blItem.studentId,'000000');ok('Admin adds scammer to blacklist');
  const blList=await call('/admin/fraud/blacklist',{admin:true});assert.ok(blList.some(b=>b.studentId==='000000'));ok('Admin lists blacklisted identities');
  await call('/orders',{method:'POST',body:{tableToken:'demo-table-03',customerType:'STUDENT',studentInfo:{campus:'Fake College',studentId:'000000',studentName:'Fake User'},items:[{productId:available[0].id,quantity:1}],paymentMethod:'CASH',idempotencyKey:'bl-block-'+run},expect:403});ok('Blacklisted identity blocked from placing student order (403)');
  await call('/admin/fraud/blacklist/'+blItem.id,{method:'DELETE',admin:true});ok('Admin removes identity from blacklist');

  await call('/admin/orders/'+studOrder.orderNumber+'/status',{method:'PATCH',admin:true,body:{status:'PROCESSING'},expect:409});ok('Unpaid student order cannot be processed');
  let x=await call('/admin/orders/'+studOrder.orderNumber+'/payment',{method:'PATCH',admin:true,body:{}});assert.equal(x.payment.status,'PAID');ok('Cash confirmation marks payment PAID');
  await call('/admin/orders/'+studOrder.orderNumber+'/status',{method:'PATCH',admin:true,body:{status:'CANCELLED'},expect:409});ok('Paid order cannot be cancelled without refund workflow');
  for(const st of ['PROCESSING','READY','COMPLETED']){x=await call('/admin/orders/'+studOrder.orderNumber+'/status',{method:'PATCH',admin:true,body:{status:st}});assert.equal(x.status,st)}ok('Order state machine NEW → PROCESSING → READY → COMPLETED');
  
  const q=await call('/orders',{method:'POST',body:{tableToken:'demo-table-02',customerType:'STUDENT',studentInfo:{campus:'ITB',studentId:'13521999',studentName:'Siti Rahma',email:'siti.rahma@itb.ac.id',studentPhoto:'data:image/jpeg;base64,itbphoto'},items:[{productId:available[1].id,quantity:1}],paymentMethod:'QRIS_DEMO',idempotencyKey:'qris-'+run},expect:201});assert.equal(q.payment.status,'PENDING');x=await call('/demo/payments/'+q.orderNumber+'/pay',{method:'POST',body:{}});assert.equal(x.payment.status,'PAID');ok('QRIS sandbox payment flow with student role');
  
  const cancel=await call('/orders',{method:'POST',body:{tableToken:'demo-table-03',customerType:'REGULAR',items:[{productId:available[2].id,quantity:1}],paymentMethod:'CASH',idempotencyKey:'cancel-'+run},expect:201});x=await call('/admin/orders/'+cancel.orderNumber+'/status',{method:'PATCH',admin:true,body:{status:'CANCELLED'}});assert.equal(x.status,'CANCELLED');ok('Unpaid order can be cancelled');
  
  const studentOrdersList=await call('/admin/orders?customerType=STUDENT',{admin:true});assert.ok(studentOrdersList.length>=2);assert.ok(studentOrdersList.every(o=>o.customerType==='STUDENT'));ok('Filter orders by customerType=STUDENT');
 const regularOrdersList=await call('/admin/orders?customerType=REGULAR',{admin:true});assert.ok(regularOrdersList.length>=2);assert.ok(regularOrdersList.every(o=>o.customerType!=='STUDENT'));ok('Filter orders by customerType=REGULAR');
 
 const dateList=await call('/admin/orders?date='+todayISO(),{admin:true});assert.ok(dateList.length>=7);ok('Order date filter works');
 let cats=await call('/admin/categories',{admin:true});const newCat=await call('/admin/categories',{method:'POST',admin:true,body:{name:'Seasonal'},expect:201});x=await call('/admin/categories/'+newCat.id,{method:'PATCH',admin:true,body:{name:'Seasonal Menu',active:false}});assert.equal(x.active,false);ok('Category create / rename / archive');
 await call('/admin/categories',{method:'POST',admin:true,body:{name:'Seasonal Menu'},expect:409});ok('Duplicate category blocked');
 
 const newProd=await call('/admin/products',{method:'POST',admin:true,body:{name:'QA Product',description:'Created by QA',price:25000,studentPrice:19000,categoryId:cats[0].id},expect:201});assert.equal(newProd.studentPrice,19000);x=await call('/admin/products/'+newProd.id,{method:'PATCH',admin:true,body:{price:30000,studentPrice:23000,isAvailable:false}});assert.equal(x.price,30000);assert.equal(x.studentPrice,23000);assert.equal(x.isAvailable,false);ok('Menu create / edit with studentPrice / sold-out');
 await call('/admin/products/'+newProd.id,{method:'PATCH',admin:true,body:{categoryId:newCat.id},expect:400});ok('Product cannot move to archived category');
 
 const newTable=await call('/admin/tables',{method:'POST',admin:true,body:{tableNumber:'13',name:'Meja QA'},expect:201});x=await call('/admin/tables/'+newTable.id,{method:'PATCH',admin:true,body:{name:'Meja 13',rotateToken:true}});assert.notEqual(x.publicToken,newTable.publicToken);assert.match(x.publicToken,/demo-table-13-v2-/);rr=await fetch(host+'/qr/'+encodeURIComponent(x.publicToken)+'.svg');assert.equal(rr.status,200);x=await call('/admin/tables/'+newTable.id,{method:'PATCH',admin:true,body:{active:false}});assert.equal(x.active,false);ok('Table create / rename / QR rotate / disable');
 await call('/admin/tables',{method:'POST',admin:true,body:{tableNumber:'13',name:'Duplicate'},expect:409});ok('Duplicate table number blocked');
 x=await call('/admin/settings',{method:'PATCH',admin:true,body:{cafeName:'Cafe Campus QA',cafeAddress:'QA Street',cafePhone:'0800',operatingHours:'08:00-22:00',serviceFee:6,taxPercent:10,qrisEnabled:false,cashEnabled:true,soundEnabled:false,dailyReportEnabled:false}});assert.equal(x.cafeName,'Cafe Campus QA');assert.equal(x.qrisEnabled,false);ok('Profile/payment/notification settings persisted');
 await call('/orders',{method:'POST',body:{tableToken:'demo-table-04',items:[{productId:available[0].id,quantity:1}],paymentMethod:'QRIS_DEMO',idempotencyKey:'disabled-qris-'+run},expect:409});ok('Disabled QRIS blocked server-side');
 await call('/admin/settings',{method:'PATCH',admin:true,body:{qrisEnabled:true,serviceFee:5,taxPercent:11}});ok('QRIS/settings restored');
 
 const report=await call('/admin/reports?days=30',{admin:true});assert.ok(report.orders>=7);assert.ok(report.revenue>0);assert.ok(Array.isArray(report.best));assert.ok('studentRevenue' in report&&'regularRevenue' in report&&'studentSavings' in report);ok('Sales analytics with student savings & dual revenue breakdown');
 const audit=await call('/admin/audit',{admin:true});assert.ok(audit.length>0);ok('Audit trail recorded');
 await call('/admin/demo/reset',{method:'POST',admin:true,body:{}});const resetDash=await call('/admin/dashboard',{admin:true});assert.equal(resetDash.totalOrders,5);assert.ok(resetDash.studentRevenue>0);const resetSettings=await call('/admin/settings',{admin:true});assert.equal(resetSettings.serviceFee,5);assert.equal(resetSettings.taxPercent,11);ok('Demo reset restores Figma seed state with student demo orders');
 console.log(`\nPASS: ${checks.length}/${checks.length} automated demo API/business checks.`);
} finally {child.kill('SIGTERM');await sleep(150)}
function todayISO(){return new Date().toISOString().slice(0,10)}

