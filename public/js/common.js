// common.js - helpers dung chung cho moi trang (can nap sau supabaseClient.js)
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

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

const ADMIN_NAV = [
  { href: '/index.html', label: 'Tổng quan' },
  { href: '/nhap-kho.html', label: 'Nhập kho' },
  { href: '/tem.html', label: 'In tem QR' },
  { href: '/xuat-kho.html', label: 'Xuất kho' },
  { href: '/nhap-kho-ve.html', label: 'Nhập kho về' },
  { href: '/lich-su.html', label: 'Lịch sử' },
  { href: '/staff.html', label: 'Nhân viên' },
  { href: '/choose-plan.html', label: 'Gói dịch vụ' }
];

const OPERATOR_NAV = [
  { href: '/xuat-kho.html', label: 'Xuất kho' },
  { href: '/nhap-kho-ve.html', label: 'Nhập kho về' },
  { href: '/lich-su.html', label: 'Lịch sử' }
];

// Ve thanh dieu huong tuy theo vai tro. profile lay tu requireLogin() o dau trang.
function renderNav(activeHref, profile) {
  const container = document.getElementById('nav-container');
  if (!container) return;
  const items = isAdmin(profile) ? ADMIN_NAV : OPERATOR_NAV;
  const links = items.map(item =>
    `<a href="${item.href}" class="${item.href === activeHref ? 'active' : ''}">${item.label}</a>`
  ).join('');
  const companyName = profile && profile.companies ? esc(profile.companies.name) : '';
  const roleLabel = isAdmin(profile) ? 'Quản trị' : 'Thao tác viên';
  container.innerHTML = `
    <header class="topbar">
      <div class="brand">📦 QR Rental Manager${companyName ? ' — ' + companyName : ''}</div>
      <nav class="tabs">${links}</nav>
      <div class="flex" style="gap:8px">
        <span class="role-badge">${roleLabel}</span>
        <button class="secondary" id="logoutBtn" style="padding:6px 12px;font-size:13px">Đăng xuất</button>
      </div>
    </header>
  `;
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
}

// Chan operator truy cap thang cac trang chi danh cho Admin (nhap-kho, tem, staff...).
// Goi ngay sau requireLogin() o dau moi trang chi-danh-cho-Admin.
function requireAdmin(profile) {
  if (!isAdmin(profile)) {
    location.href = '/xuat-kho.html';
    return false;
  }
  return true;
}
