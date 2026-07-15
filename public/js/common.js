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
  { href: '/giu-cho.html', label: 'Giữ chỗ' },
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
        <button class="secondary" id="installAppBtn" style="display:none;padding:6px 12px;font-size:13px">📲 Cài app</button>
        <button class="secondary" id="logoutBtn" style="padding:6px 12px;font-size:13px">Đăng xuất</button>
      </div>
    </header>
  `;
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
  if (typeof attachInstallButton === 'function') attachInstallButton('installAppBtn');
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

// Gan thanh dieu khien camera (zoom + den flash + lay net) ngay duoi khung quet #reader,
// tuy theo thiet bi/trinh duyet ho tro tinh nang nao thi hien tinh nang do (thuong chi
// hoat dong day du tren Android Chrome; iPhone Safari phan lon khong ho tro torch/zoom/
// focus qua web nen se tu an cac nut khong dung duoc, khong bao loi cho nguoi dung).
// Goi lai moi lan camera (re)start thanh cong, vi kha nang thiet bi co the khac nhau.
function attachZoomControl(scanner) {
  try {
    const caps = scanner.getRunningTrackCameraCapabilities && scanner.getRunningTrackCameraCapabilities();
    const reader = document.getElementById('reader');
    let box = document.getElementById('zoomControl');

    const zoom = caps && caps.zoomFeature && caps.zoomFeature();
    const zoomOk = zoom && zoom.isSupported && zoom.isSupported();
    const torch = caps && caps.torchFeature && caps.torchFeature();
    const torchOk = torch && torch.isSupported && torch.isSupported();
    const focusMode = caps && caps.focusModeFeature && caps.focusModeFeature();
    const focusOk = focusMode && focusMode.isSupported && focusMode.isSupported();

    if (!zoomOk && !torchOk && !focusOk) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'zoomControl';
      box.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:8px';
      reader.insertAdjacentElement('afterend', box);
    }
    box.innerHTML = `
      ${zoomOk ? `<div style="display:flex;align-items:center;gap:8px">
        <span class="muted" style="font-size:12.5px;white-space:nowrap">🔍 Zoom</span>
        <button type="button" class="secondary" id="zoomOutBtn" style="padding:4px 10px">−</button>
        <input type="range" id="zoomSlider" style="flex:1">
        <button type="button" class="secondary" id="zoomInBtn" style="padding:4px 10px">+</button>
        <span class="mono" id="zoomVal" style="min-width:36px;text-align:right;font-size:12.5px"></span>
      </div>` : ''}
      ${(torchOk || focusOk) ? `<div style="display:flex;gap:8px">
        ${torchOk ? `<button type="button" class="secondary" id="torchBtn" style="flex:1;padding:7px 10px;font-size:13px">🔦 Bật đèn</button>` : ''}
        ${focusOk ? `<button type="button" class="secondary" id="focusBtn" style="flex:1;padding:7px 10px;font-size:13px">🎯 Lấy nét</button>` : ''}
      </div>` : ''}
    `;

    // ---- Zoom (nhu cu, mac dinh 35% khoang cho phep de de quet tem nho) ----
    if (zoomOk) {
      const min = zoom.min(), max = zoom.max(), step = zoom.step() || 0.1;
      const slider = document.getElementById('zoomSlider');
      slider.min = min; slider.max = max; slider.step = step;
      const valEl = document.getElementById('zoomVal');
      const apply = (v) => {
        v = Math.min(max, Math.max(min, Number(v)));
        slider.value = v;
        zoom.apply(v);
        valEl.textContent = v.toFixed(1) + 'x';
      };
      apply(min + (max - min) * 0.35);
      slider.addEventListener('input', () => apply(slider.value));
      document.getElementById('zoomOutBtn').addEventListener('click', () => apply(Number(slider.value) - step * 5));
      document.getElementById('zoomInBtn').addEventListener('click', () => apply(Number(slider.value) + step * 5));
    }

    // ---- Den flash (torch) - bat/tat de quet trong dieu kien thieu sang ----
    if (torchOk) {
      let torchOn = false;
      const torchBtn = document.getElementById('torchBtn');
      torchBtn.addEventListener('click', () => {
        torchOn = !torchOn;
        try {
          torch.apply(torchOn);
          torchBtn.textContent = torchOn ? '🔦 Tắt đèn' : '🔦 Bật đèn';
          torchBtn.classList.toggle('active-torch', torchOn);
          torchBtn.style.background = torchOn ? 'var(--warn)' : '';
          torchBtn.style.color = torchOn ? '#fff' : '';
          torchBtn.style.borderColor = torchOn ? 'var(--warn)' : '';
        } catch (e) {
          toast('Thiết bị này không bật được đèn qua trình duyệt', 'error');
        }
      });
    }

    // ---- Lay net (focus) - bat lay net lien tuc mac dinh, co nut lay net lai thu cong ----
    if (focusOk) {
      try { focusMode.apply('continuous'); } catch (e) { /* mac dinh cua camera */ }
      const focusBtn = document.getElementById('focusBtn');
      focusBtn.addEventListener('click', () => {
        // Meo pho bien: tat rồi bat lai che do lay net de camera quet lay net mot lan nua.
        try {
          focusMode.apply('single-shot');
          setTimeout(() => { try { focusMode.apply('continuous'); } catch (e) {} }, 400);
          focusBtn.textContent = '🎯 Đang lấy nét...';
          setTimeout(() => { focusBtn.textContent = '🎯 Lấy nét'; }, 600);
        } catch (e) {
          toast('Thiết bị này không hỗ trợ lấy nét thủ công qua trình duyệt', 'error');
        }
      });
    }
  } catch (e) {
    // Camera/trinh duyet khong ho tro cac tinh nang nay -> bo qua, van quet binh thuong.
  }
}
