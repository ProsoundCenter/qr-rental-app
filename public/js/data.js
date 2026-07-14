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

// ---------- EXCEL (.xlsx) — dung thu vien xlsx-js-style (nap qua CDN, bien global XLSX) ----------

function xlsxBorderThin() {
  const side = { style: 'thin', color: { rgb: 'D0D0D0' } };
  return { top: side, bottom: side, left: side, right: side };
}

function xlsxSetStyle(ws, r, c, style) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: 's', v: '' };
  ws[addr].s = Object.assign({}, ws[addr].s, style);
}

function xlsxHeaderStyle() {
  return {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '2563EB' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: xlsxBorderThin()
  };
}

// Bien ban giao nhan thiet bi theo show: header cong ty, thong tin show, danh muc thiet bi
// GOP THEO MODEL (so luong) de khach de kiem dem/ban giao — khong hien gia tri khau hao.
async function downloadRentalXlsx(profile, rental) {
  if (typeof XLSX === 'undefined') { toast('Không tải được thư viện Excel, vui lòng thử lại', 'error'); return; }
  const items = await getRentalItems(rental.id);
  const companyName = (profile.companies && profile.companies.name) || '';

  const groups = [];
  const groupMap = new Map();
  items.forEach(i => {
    const a = i.assets || {};
    const key = [a.asset_group || '', a.category || '', a.brand || '', a.model || ''].join('||').toLowerCase();
    if (!groupMap.has(key)) {
      const g = { asset_group: a.asset_group || '', category: a.category || '', brand: a.brand || '', model: a.model || '', qty: 0, codes: [] };
      groupMap.set(key, g);
      groups.push(g);
    }
    const g = groupMap.get(key);
    g.qty++;
    g.codes.push(a.qr_code || '');
  });
  groups.sort((x, y) => (x.asset_group + x.category + x.brand + x.model).localeCompare(y.asset_group + y.category + y.brand + y.model, 'vi'));

  const COLS = 6;
  const headers = ['STT', 'Nhóm / Chủng loại', 'Nhãn hiệu', 'Model', 'Số lượng', 'Danh sách mã QR'];

  const aoa = [];
  aoa.push([companyName]);
  aoa.push(['BIÊN BẢN GIAO NHẬN THIẾT BỊ']);
  aoa.push(['Show: ' + rental.show_name + ' (' + rental.code + ')']);
  aoa.push(['Khách hàng: ' + (rental.customer || '—') + '     Địa điểm: ' + (rental.location || '—')]);
  aoa.push(['Thời gian: ' + fmtDate(rental.start_datetime) + ' → ' + fmtDate(rental.end_datetime)]);
  aoa.push([]);
  const headerRowIdx = aoa.length;
  aoa.push(headers);
  groups.forEach((g, idx) => {
    aoa.push([
      idx + 1,
      [g.asset_group, g.category].filter(Boolean).join(' / '),
      g.brand,
      g.model,
      g.qty,
      g.codes.join(', ')
    ]);
  });
  const totalRowIdx = aoa.length;
  const totalRow = new Array(COLS).fill('');
  totalRow[3] = 'Tổng số lượng thiết bị:';
  totalRow[4] = items.length;
  aoa.push(totalRow);
  aoa.push([]);
  aoa.push([]);
  const sigRowIdx = aoa.length;
  const sigRow1 = new Array(COLS).fill('');
  sigRow1[0] = 'Người giao thiết bị';
  sigRow1[4] = 'Người nhận thiết bị';
  aoa.push(sigRow1);
  const sigRow2 = new Array(COLS).fill('');
  sigRow2[0] = '(Ký, ghi rõ họ tên)';
  sigRow2[4] = '(Ký, ghi rõ họ tên)';
  aoa.push(sigRow2);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: COLS - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: COLS - 1 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: COLS - 1 } },
    { s: { r: sigRowIdx, c: 0 }, e: { r: sigRowIdx, c: 2 } },
    { s: { r: sigRowIdx, c: 4 }, e: { r: sigRowIdx, c: 5 } },
    { s: { r: sigRowIdx + 1, c: 0 }, e: { r: sigRowIdx + 1, c: 2 } },
    { s: { r: sigRowIdx + 1, c: 4 }, e: { r: sigRowIdx + 1, c: 5 } }
  ];
  ws['!cols'] = [{ wch: 5 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 42 }];
  ws['!rows'] = [{ hpt: 22 }, { hpt: 24 }];

  xlsxSetStyle(ws, 0, 0, { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } });
  xlsxSetStyle(ws, 1, 0, { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } });
  for (let r = 2; r <= 4; r++) xlsxSetStyle(ws, r, 0, { alignment: { horizontal: 'center' } });
  for (let c = 0; c < COLS; c++) xlsxSetStyle(ws, headerRowIdx, c, xlsxHeaderStyle());
  for (let r = headerRowIdx + 1; r <= headerRowIdx + groups.length; r++) {
    for (let c = 0; c < COLS; c++) {
      xlsxSetStyle(ws, r, c, { border: xlsxBorderThin(), alignment: { vertical: 'center', horizontal: c === 4 ? 'center' : (c === 0 ? 'center' : 'left'), wrapText: c === 5 } });
    }
  }
  xlsxSetStyle(ws, totalRowIdx, 3, { font: { bold: true }, alignment: { horizontal: 'right' } });
  xlsxSetStyle(ws, totalRowIdx, 4, { font: { bold: true }, alignment: { horizontal: 'center' } });
  xlsxSetStyle(ws, sigRowIdx, 0, { font: { bold: true }, alignment: { horizontal: 'center' } });
  xlsxSetStyle(ws, sigRowIdx, 4, { font: { bold: true }, alignment: { horizontal: 'center' } });
  xlsxSetStyle(ws, sigRowIdx + 1, 0, { font: { italic: true, sz: 10 }, alignment: { horizontal: 'center' } });
  xlsxSetStyle(ws, sigRowIdx + 1, 4, { font: { italic: true, sz: 10 }, alignment: { horizontal: 'center' } });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bien ban');
  XLSX.writeFile(wb, rental.code + '_bien_ban_thiet_bi.xlsx');
}

// Xuat toan bo danh sach thiet bi ra Excel (sao luu / doi chieu).
async function downloadAssetsXlsx(profile) {
  if (typeof XLSX === 'undefined') { toast('Không tải được thư viện Excel, vui lòng thử lại', 'error'); return; }
  const assets = await listAssets();
  const headers = ['Mã QR', 'Nhóm', 'Chủng loại', 'Nhãn hiệu', 'Model', 'Mô tả', 'Ngày sản xuất', 'Ngày nhập', 'Giá trị nhập (đ)', 'Kiểu khấu hao', 'Số kỳ khấu hao', 'Số lần đã thuê', 'Đã khấu hao (đ)', 'Trạng thái'];
  const aoa = [headers];
  assets.forEach(a => {
    aoa.push([
      a.qr_code, a.asset_group, a.category, a.brand, a.model, a.description,
      a.manufacture_date || '', a.import_date || '',
      Number(a.import_value) || 0,
      a.depreciation_type === 'show' ? 'show' : 'month',
      Number(a.depreciation_period) || 0,
      a.rental_count || 0,
      Number(a.total_depreciated) || 0,
      a.status === 'rented' ? 'Đang cho thuê' : 'Sẵn sàng'
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 13 }];
  for (let c = 0; c < headers.length; c++) xlsxSetStyle(ws, 0, c, xlsxHeaderStyle());
  for (let r = 1; r < aoa.length; r++) for (let c = 0; c < headers.length; c++) xlsxSetStyle(ws, r, c, { border: xlsxBorderThin() });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Danh sach thiet bi');
  XLSX.writeFile(wb, 'danh-sach-thiet-bi.xlsx');
}

// Tai file mau de nhap kho hang loat qua Excel.
function downloadAssetsTemplateXlsx() {
  if (typeof XLSX === 'undefined') { toast('Không tải được thư viện Excel, vui lòng thử lại', 'error'); return; }
  const headers = ['Mã QR (để trống sẽ tự tạo)', 'Nhóm *', 'Chủng loại', 'Nhãn hiệu', 'Model *', 'Mô tả', 'Ngày sản xuất (dd/mm/yyyy)', 'Ngày nhập (dd/mm/yyyy)', 'Giá trị nhập (đ)', 'Kiểu khấu hao (month/show)', 'Số kỳ khấu hao'];
  const example = ['', 'Âm thanh', 'Loa', 'JBL', 'SRX835P', 'Loa full 3 đường tiếng', '01/01/2025', '15/01/2025', 20000000, 'month', 24];
  const aoa = [headers, example];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  for (let c = 0; c < headers.length; c++) xlsxSetStyle(ws, 0, c, xlsxHeaderStyle());
  for (let c = 0; c < headers.length; c++) xlsxSetStyle(ws, 1, c, { border: xlsxBorderThin() });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mau nhap kho');
  XLSX.writeFile(wb, 'mau-nhap-kho-excel.xlsx');
}

function parseDateFlexible(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  return null;
}

function excelCellToDateStr(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return parseDateFlexible(v);
}

// Nhap kho hang loat tu file Excel (.xlsx) theo dinh dang file mau. Co ma QR trung -> cap nhat,
// khong co / trong -> tao moi (tu sinh ma neu trong).
async function importAssetsFromXlsxFile(profile, file) {
  if (typeof XLSX === 'undefined') throw new Error('Không tải được thư viện đọc Excel, vui lòng thử lại');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const wsName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { header: 1, defval: '' });
  let created = 0, updated = 0, skipped = 0;
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;
    let qr_code = String(row[0] || '').trim();
    const asset_group = String(row[1] || '').trim();
    const category = String(row[2] || '').trim();
    const brand = String(row[3] || '').trim();
    const model = String(row[4] || '').trim();
    const description = String(row[5] || '').trim();
    const manufacture_date = excelCellToDateStr(row[6]);
    const import_date = excelCellToDateStr(row[7]);
    const import_value = Number(row[8]) || 0;
    const depTypeRaw = String(row[9] || '').trim().toLowerCase();
    const depreciation_type = depTypeRaw === 'show' ? 'show' : 'month';
    const depreciation_period = Number(row[10]) || 0;
    if (!asset_group || !model) { errors.push('Dòng ' + (i + 1) + ': thiếu Nhóm hoặc Model, đã bỏ qua'); skipped++; continue; }
    try {
      let existing = null;
      if (qr_code) existing = await getAssetByCode(qr_code);
      if (existing) {
        const { error } = await sb.from('assets').update({
          asset_group, category, brand, model, description,
          manufacture_date, import_date, import_value, depreciation_type, depreciation_period
        }).eq('id', existing.id);
        if (error) throw error;
        updated++;
      } else {
        if (!qr_code) qr_code = await nextCode(profile.company_id, 'assets', 'TS-');
        const { error } = await sb.from('assets').insert({
          company_id: profile.company_id, qr_code, asset_group, category, brand, model, description,
          manufacture_date, import_date, import_value, depreciation_type, depreciation_period,
          status: 'available', created_by: profile.id
        });
        if (error) {
          if (String(error.code) === '23505') throw new Error('Mã QR đã tồn tại');
          throw error;
        }
        created++;
      }
    } catch (e) {
      errors.push('Dòng ' + (i + 1) + ' (' + (qr_code || 'tự tạo') + '): ' + (e.message || e));
      skipped++;
    }
  }
  return { created, updated, skipped, errors };
}
