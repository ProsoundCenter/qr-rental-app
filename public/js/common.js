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
      <div class="brand" style="display:flex;align-items:center;gap:8px">
        <svg width="26" height="26" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" style="flex:none">
          <defs><linearGradient id="navLogoGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs>
          <rect width="44" height="44" rx="12" fill="rgba(255,255,255,0.18)"/>
          <g fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
            <path d="M22 9 L34 15 L34 29 L22 35 L10 29 L10 15 Z"/>
            <path d="M10 15 L22 21 L34 15"/>
            <path d="M22 21 L22 35"/>
          </g>
        </svg>
        <span>Rental APP${companyName ? ' — ' + companyName : ''}</span>
      </div>
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

// Gan thanh truot zoom camera ngay duoi khung quet #reader (neu thiet bi/trinh duyet ho tro).
// Goi lai moi lan camera (re)start thanh cong, vi kha nang zoom co the khac nhau giua cac camera.
// Mac dinh zoom nhe (~35% khoang cho phep) de de quet tem QR nho ngoai thuc te hon so voi mac dinh 1x.
function attachZoomControl(scanner) {
  try {
    const caps = scanner.getRunningTrackCameraCapabilities && scanner.getRunningTrackCameraCapabilities();
    const zoom = caps && caps.zoomFeature && caps.zoomFeature();
    const reader = document.getElementById('reader');
    let box = document.getElementById('zoomControl');
    if (!zoom || !zoom.isSupported || !zoom.isSupported()) {
      if (box) box.remove();
      return;
    }
    const min = zoom.min(), max = zoom.max(), step = zoom.step() || 0.1;
    if (!box) {
      box = document.createElement('div');
      box.id = 'zoomControl';
      box.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px';
      reader.insertAdjacentElement('afterend', box);
    }
    box.innerHTML = `
      <span class="muted" style="font-size:12.5px;white-space:nowrap">🔍 Zoom</span>
      <button type="button" class="secondary" id="zoomOutBtn" style="padding:4px 10px">−</button>
      <input type="range" id="zoomSlider" min="${min}" max="${max}" step="${step}" style="flex:1">
      <button type="button" class="secondary" id="zoomInBtn" style="padding:4px 10px">+</button>
      <span class="mono" id="zoomVal" style="min-width:36px;text-align:right;font-size:12.5px"></span>
    `;
    const slider = document.getElementById('zoomSlider');
    const valEl = document.getElementById('zoomVal');
    const apply = (v) => {
      v = Math.min(max, Math.max(min, Number(v)));
      slider.value = v;
      zoom.apply(v);
      valEl.textContent = v.toFixed(1) + 'x';
    };
    const startVal = min + (max - min) * 0.35;
    apply(startVal);
    slider.addEventListener('input', () => apply(slider.value));
    document.getElementById('zoomOutBtn').addEventListener('click', () => apply(Number(slider.value) - step * 5));
    document.getElementById('zoomInBtn').addEventListener('click', () => apply(Number(slider.value) + step * 5));
  } catch (e) {
    // Camera/trinh duyet khong ho tro zoom -> bo qua, van dung ban Zoom-1x mac dinh.
  }
}
