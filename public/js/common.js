// common.js - shared helpers used by all pages
function money(n) {
  n = Number(n) || 0;
  return n.toLocaleString('vi-VN') + ' đ';
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('vi-VN');
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {});
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : ('Loi (' + res.status + ')');
    throw new Error(msg);
  }
  return data;
}

const NAV_ITEMS = [
  { href: '/index.html', label: 'Tổng quan' },
  { href: '/nhap-kho.html', label: 'Nhập kho' },
  { href: '/tem.html', label: 'In tem QR' },
  { href: '/xuat-kho.html', label: 'Xuất kho (Quét QR)' },
  { href: '/lich-su.html', label: 'Lịch sử show' }
];

function renderNav(activeHref) {
  const container = document.getElementById('nav-container');
  if (!container) return;
  const links = NAV_ITEMS.map(item =>
    `<a href="${item.href}" class="${item.href === activeHref ? 'active' : ''}">${item.label}</a>`
  ).join('');
  container.innerHTML = `
    <header class="topbar">
      <div class="brand">📦 QR Rental Manager</div>
      <nav class="tabs">${links}</nav>
    </header>
  `;
}
