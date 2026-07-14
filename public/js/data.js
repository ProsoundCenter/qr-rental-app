// data.js - lop truy cap du lieu qua Supabase (thay the server.js / db.js cu).
// Yeu cau da nap truoc: supabaseClient.js, common.js.

async function nextCode(companyId, table, prefix) {
  const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  if (error) throw error;
  return prefix + String((count || 0) + 1).padStart(5, '0');
}

function unitDepreciation(importValue, period) {
  period = Number(period) || 0;
  if (period <= 0) return 0;
  return round2(Number(importValue) / period);
}

// ---------- ASSETS ----------
async function listAssets() {
  const { data, error } = await sb.from('assets').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getAsset(id) {
  const { data, error } = await sb.from('assets').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function getAssetByCode(code) {
  const { data, error } = await sb.from('assets').select('*').eq('qr_code', code).maybeSingle();
  if (error) throw error;
  return data;
}

async function createAsset(profile, b) {
  if (!b.asset_group || !b.model) throw new Error('Thiếu Nhóm sản phẩm hoặc Model');
  const importValue = Number(b.import_value) || 0;
  const period = Number(b.depreciation_period) || 0;
  let qrCode = (b.qr_code && String(b.qr_code).trim()) || null;
  if (!qrCode) qrCode = await nextCode(profile.company_id, 'assets', 'TS-');
  const row = {
    company_id: profile.company_id,
    qr_code: qrCode,
    asset_group: b.asset_group || '',
    category: b.category || '',
    brand: b.brand || '',
    model: b.model || '',
    description: b.description || '',
    manufacture_date: b.manufacture_date || null,
    import_date: b.import_date || null,
    import_value: importValue,
    depreciation_type: b.depreciation_type === 'show' ? 'show' : 'month',
    depreciation_period: period,
    status: 'available',
    created_by: profile.id
  };
  const { data, error } = await sb.from('assets').insert(row).select().single();
  if (error) {
    if (String(error.code) === '23505') throw new Error('Mã QR này đã tồn tại, vui lòng chọn mã khác');
    throw error;
  }
  return data;
}

async function updateAsset(id, b) {
  const row = {
    qr_code: b.qr_code,
    asset_group: b.asset_group,
    category: b.category,
    brand: b.brand,
    model: b.model,
    description: b.description,
    manufacture_date: b.manufacture_date || null,
    import_date: b.import_date || null,
    import_value: Number(b.import_value) || 0,
    depreciation_type: b.depreciation_type === 'show' ? 'show' : 'month',
    depreciation_period: Number(b.depreciation_period) || 0
  };
  if (b.status) row.status = b.status;
  const { data, error } = await sb.from('assets').update(row).eq('id', id).select().single();
  if (error) {
    if (String(error.code) === '23505') throw new Error('Mã QR này đã được dùng bởi tài sản khác');
    throw error;
  }
  return data;
}

async function deleteAsset(id) {
  const { error } = await sb.from('assets').delete().eq('id', id);
  if (error) throw error;
}

// ---------- RENTALS ----------
async function listRentals() {
  const { data, error } = await sb.from('rentals').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getRental(id) {
  const { data, error } = await sb.from('rentals').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function getRentalItems(rentalId) {
  const { data, error } = await sb
    .from('rental_items')
    .select('*, assets(qr_code, asset_group, category, brand, model, depreciation_type)')
    .eq('rental_id', rentalId)
    .order('scanned_out_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function createRental(profile, b) {
  if (!b.showName || !b.startDateTime || !b.endDateTime) {
    throw new Error('Thiếu Tên show, thời gian bắt đầu hoặc kết thúc');
  }
  const code = await nextCode(profile.company_id, 'rentals', 'SH-');
  const row = {
    company_id: profile.company_id,
    code,
    show_name: b.showName,
    customer: b.customer || '',
    location: b.location || '',
    start_datetime: b.startDateTime,
    end_datetime: b.endDateTime,
    status: 'active',
    created_by: profile.id
  };
  const { data, error } = await sb.from('rentals').insert(row).select().single();
  if (error) throw error;
  return data;
}

async function closeRental(id) {
  const { error } = await sb.from('rentals').update({ status: 'closed' }).eq('id', id);
  if (error) throw error;
}

// Quet xuat kho: 1 ma QR -> 1 dong rental_items, tru khau hao, danh dau asset dang cho thue.
async function scanCheckout(profile, rental, code) {
  code = String(code || '').trim();
  if (!code) throw new Error('Mã QR trống');
  const asset = await getAssetByCode(code);
  if (!asset) throw new Error(`Không tìm thấy thiết bị với mã QR: ${code}`);
  if (asset.status === 'rented') throw new Error(`Thiết bị [${asset.qr_code}] đang được cho thuê ở show khác, chưa về kho`);

  const unit = unitDepreciation(asset.import_value, asset.depreciation_period);
  let deduction = 0;
  if (asset.depreciation_type === 'show') {
    deduction = unit;
  } else {
    const start = new Date(rental.start_datetime);
    const end = new Date(rental.end_datetime);
    let days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (!days || days < 1) days = 1;
    deduction = round2(unit * (days / 30));
  }
  const maxAllowed = round2(Number(asset.import_value) - Number(asset.total_depreciated));
  if (deduction > maxAllowed) deduction = maxAllowed;
  if (deduction < 0) deduction = 0;

  const { error: itemErr } = await sb.from('rental_items').insert({
    company_id: profile.company_id,
    rental_id: rental.id,
    asset_id: asset.id,
    deduction_value: deduction,
    scanned_out_by: profile.id
  });
  if (itemErr) {
    if (String(itemErr.code) === '23505') throw new Error(`Thiết bị [${asset.qr_code}] đã có trong danh sách của show này`);
    throw itemErr;
  }

  const newTotalDep = round2(Number(asset.total_depreciated) + deduction);
  const { error: assetErr } = await sb.from('assets').update({
    rental_count: (asset.rental_count || 0) + 1,
    total_depreciated: newTotalDep,
    status: 'rented'
  }).eq('id', asset.id);
  if (assetErr) throw assetErr;

  const { data: items } = await sb.from('rental_items').select('deduction_value').eq('rental_id', rental.id);
  const totalDep = round2((items || []).reduce((s, i) => s + Number(i.deduction_value), 0));
  await sb.from('rentals').update({ total_depreciation_value: totalDep }).eq('id', rental.id);

  return { asset, deduction, qrCode: asset.qr_code };
}

// Quet nhap kho ve: tim dong rental_items con mo (scanned_in_at is null) cua ma QR nay,
// danh dau da tra, cap nhat asset ve 'available'. Neu ca show da tra het -> tu dong
// chuyen rental sang 'returned'.
async function scanReturn(profile, code) {
  code = String(code || '').trim();
  if (!code) throw new Error('Mã QR trống');
  const asset = await getAssetByCode(code);
  if (!asset) throw new Error(`Không tìm thấy thiết bị với mã QR: ${code}`);
  if (asset.status !== 'rented') throw new Error(`Thiết bị [${asset.qr_code}] hiện không ở trạng thái đang cho thuê`);

  const { data: openItem, error: openErr } = await sb
    .from('rental_items')
    .select('*, rentals(id, code, show_name, status)')
    .eq('asset_id', asset.id)
    .is('scanned_in_at', null)
    .order('scanned_out_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openErr) throw openErr;
  if (!openItem) throw new Error(`Không tìm thấy lượt xuất kho đang mở cho thiết bị [${asset.qr_code}]`);

  const { error: updItemErr } = await sb.from('rental_items').update({
    scanned_in_at: new Date().toISOString(),
    scanned_in_by: profile.id
  }).eq('id', openItem.id);
  if (updItemErr) throw updItemErr;

  const { error: updAssetErr } = await sb.from('assets').update({ status: 'available' }).eq('id', asset.id);
  if (updAssetErr) throw updAssetErr;

  const { count } = await sb
    .from('rental_items')
    .select('id', { count: 'exact', head: true })
    .eq('rental_id', openItem.rental_id)
    .is('scanned_in_at', null);
  let rentalReturned = false;
  if (!count) {
    await sb.from('rentals').update({ status: 'returned' }).eq('id', openItem.rental_id);
    rentalReturned = true;
  }

  return { asset, rental: openItem.rentals, rentalReturned };
}

// Xoa 1 dong rental_items (thiet bi quet nham), hoan tra khau hao + trang thai asset,
// va tinh lai tong khau hao cua rental cho dung (tranh so tien "treo" sau khi xoa).
async function removeRentalItem(rentalId, item) {
  const { error: delErr } = await sb.from('rental_items').delete().eq('id', item.id);
  if (delErr) throw delErr;

  const asset = await getAsset(item.asset_id);
  const { error: assetErr } = await sb.from('assets').update({
    rental_count: Math.max(0, (asset.rental_count || 0) - 1),
    total_depreciated: round2(Math.max(0, Number(asset.total_depreciated || 0) - Number(item.deduction_value))),
    status: 'available'
  }).eq('id', item.asset_id);
  if (assetErr) throw assetErr;

  const { data: items } = await sb.from('rental_items').select('deduction_value').eq('rental_id', rentalId);
  const totalDep = round2((items || []).reduce((s, i) => s + Number(i.deduction_value), 0));
  const { error: rentalErr } = await sb.from('rentals').update({ total_depreciation_value: totalDep }).eq('id', rentalId);
  if (rentalErr) throw rentalErr;
}

function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function downloadRentalCsv(profile, rental) {
  const items = await getRentalItems(rental.id);
  const lines = [];
  lines.push(csvEscape(profile.companies ? profile.companies.name : ''));
  lines.push(csvEscape('BIEN BAN XUAT KHO THIET BI - Show: ' + rental.show_name + ' (' + rental.code + ')'));
  lines.push(csvEscape('Khach hang: ' + (rental.customer || '')) + ',' + csvEscape('Dia diem: ' + (rental.location || '')));
  lines.push(csvEscape('Tu: ' + fmtDate(rental.start_datetime)) + ',' + csvEscape('Den: ' + fmtDate(rental.end_datetime)));
  lines.push('');
  lines.push(['Ma QR', 'Nhom', 'Chung loai', 'Nhan hieu', 'Model', 'Kieu khau hao', 'Gia tri khau hao', 'Thoi diem xuat', 'Thoi diem tra'].map(csvEscape).join(','));
  items.forEach(i => {
    const a = i.assets || {};
    lines.push([
      a.qr_code, a.asset_group, a.category, a.brand, a.model,
      a.depreciation_type === 'show' ? 'Theo show' : 'Theo thang',
      i.deduction_value, fmtDate(i.scanned_out_at), i.scanned_in_at ? fmtDate(i.scanned_in_at) : ''
    ].map(csvEscape).join(','));
  });
  lines.push('');
  lines.push(csvEscape('Tong gia tri khau hao: ' + money(rental.total_depreciation_value)));
  lines.push('');
  lines.push('');
  lines.push(',' + csvEscape('Nguoi phu trach (Ky, ghi ro ho ten)'));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = rental.code + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
