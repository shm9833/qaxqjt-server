// 新接口全链路冒烟：登录 → orders/fin/inventory CRUD + 状态流转 + 记录联动
const BASE = 'http://127.0.0.1:3001/v1';
let TOKEN = '';
const _r = async (m, p, b) => {
  const res = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: b ? JSON.stringify(b) : undefined
  });
  let j = null;
  try { j = await res.json(); } catch (_e) {}
  return { status: res.status, j };
};
(async () => {
  // 1. 登录
  const login = await _r('POST', '/auth/login', { username: 'admin', password: 'admin123456' });
  if (login.status !== 200 || !login.j?.data?.accessToken) {
    console.log('LOGIN FAIL', login.status, JSON.stringify(login.j)); process.exit(1);
  }
  TOKEN = login.j.data.accessToken;
  console.log('[1] login OK');

  // 2. 创建订单
  const co = await _r('POST', '/orders', {
    customerName: '王建国', phone: '13900001234', orderType: 'performance',
    totalAmount: 20400, finalAmount: 20400, performanceCount: 3,
    venueFullAddress: '陇城镇张沟村', performanceStartDate: '2026-02-15'
  });
  console.log('[2] order create:', co.status, co.j?.data?.orderNo, 'status=' + co.j?.data?.status);
  const orderId = co.j?.data?.id;

  // 3. 列表 + 过滤
  const lo = await _r('GET', '/orders?keyword=王建国&page=1&pageSize=10');
  console.log('[3] order list total:', lo.j?.meta?.total);

  // 4. 状态流转 draft→confirmed→performance
  const t1 = await _r('POST', `/orders/${orderId}/transition`, { to: 'confirmed' });
  console.log('[4] transition confirmed:', t1.status, t1.j?.data?.status);
  const t2 = await _r('POST', `/orders/${orderId}/transition`, { to: 'performance' });
  console.log('[4] transition performance:', t2.status, t2.j?.data?.status);
  // 非法流转 performance→draft 应 422
  const t3 = await _r('POST', `/orders/${orderId}/transition`, { to: 'draft' });
  console.log('[4] illegal transition blocked:', t3.status, t3.j?.error?.code || '');

  // 5. stats
  const st = await _r('GET', '/orders/stats');
  console.log('[5] order stats:', JSON.stringify(st.j?.data));

  // 6. 财务制单（收入 + 支出）
  const c1 = await _r('POST', '/fin/ledger', { summary: '庙会包场演出收入', creditAmount: 20400, voucherCategory: '演出收入' });
  console.log('[6] ledger income:', c1.status, c1.j?.data?.voucherNo);
  const c2 = await _r('POST', '/fin/ledger', { summary: '演员日工资发放', debitAmount: 8600, voucherCategory: '人员成本' });
  console.log('[6] ledger expense:', c2.status, c2.j?.data?.voucherNo);
  const sum = await _r('GET', '/fin/summary?months=3');
  console.log('[6] fin summary rows:', sum.j?.data?.length, JSON.stringify(sum.j?.data?.[sum.j.data.length - 1]));

  // 7. 库存：建物品 → 入库 → 借用 → 归还
  const ci = await _r('POST', '/inventory/items', { name: '靠旗', category: '道具', specModel: '标准款', quantity: 0, safetyStock: 5, unit: '副' });
  console.log('[7] item create:', ci.status, ci.j?.data?.id);
  const itemId = ci.j?.data?.id;
  const r1 = await _r('POST', '/inventory/records', { itemId, opType: 'in', quantity: 10 });
  const q1 = await _r('GET', `/inventory/items/${itemId}`);
  console.log('[7] after in 10 => qty:', q1.j?.data?.quantity);
  const r2 = await _r('POST', '/inventory/records', { itemId, opType: 'borrow', quantity: 2, borrower: '张三', expectedReturnDate: '2026-09-10' });
  const q2 = await _r('GET', `/inventory/items/${itemId}`);
  console.log('[7] after borrow 2 => qty:', q2.j?.data?.quantity, 'status:', q2.j?.data?.status, 'borrower:', q2.j?.data?.borrower);
  const r3 = await _r('POST', '/inventory/records', { itemId, opType: 'return', quantity: 2 });
  const q3 = await _r('GET', `/inventory/items/${itemId}`);
  console.log('[7] after return 2 => qty:', q3.j?.data?.quantity, 'status:', q3.j?.data?.status);
  // 超库存出库应 409
  const r4 = await _r('POST', '/inventory/records', { itemId, opType: 'out', quantity: 999 });
  console.log('[7] over-out blocked:', r4.status, r4.j?.error?.code || '');
  const recs = await _r('GET', `/inventory/records?itemId=${itemId}`);
  console.log('[7] records count:', recs.j?.meta?.total, 'with item join:', !!recs.j?.data?.[0]?.item);

  // 8. 清理测试数据（订单删除仅 draft/cancelled 可删 → 走 PATCH 到 cancelled 再删）
  await _r('POST', `/orders/${orderId}/transition`, { to: 'cancelled' });
  const del = await _r('DELETE', `/orders/${orderId}`);
  console.log('[8] order delete:', del.status);
  const d2 = await _r('DELETE', `/inventory/items/${itemId}`);
  console.log('[8] item delete:', d2.status);
  console.log('ALL DONE');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
