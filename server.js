// server.js - QR Rental Asset Manager
// Pure Node.js (http, fs, crypto) - zero external npm dependencies required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- small helpers ----------
function uuid() { return crypto.randomUUID(); }
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Khong tim thay trang');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- business logic ----------
function nextAssetCode(data) {
  data.counters.assetSeq += 1;
  return 'TS-' + String(data.counters.assetSeq).padStart(5, '0');
}
function nextRentalCode(data) {
  data.counters.rentalSeq += 1;
  return 'SH-' + String(data.counters.rentalSeq).padStart(5, '0');
}
function computeUnitDepreciation(asset) {
  const period = Number(asset.depreciationPeriod) || 0;
  if (period <= 0) return 0;
  return round2(Number(asset.importValue) / period);
}
function recalcAsset(asset) {
  asset.depreciationUnitValue = computeUnitDepreciation(asset);
  const totalDep = Math.min(asset.totalDepreciated || 0, Number(asset.importValue) || 0);
  asset.totalDepreciated = round2(totalDep);
  asset.remainingValue = round2((Number(asset.importValue) || 0) - asset.totalDepreciated);
  return asset;
}
function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------- route handlers ----------
const routes = [];
function route(method, pattern, handler) {
  // pattern like /api/assets/:id -> regex with named group
  const paramNames = [];
  const regexStr = pattern.replace(/:[^/]+/g, (m) => {
    paramNames.push(m.slice(1));
    return '([^/]+)';
  });
  const regex = new RegExp('^' + regexStr + '$');
  routes.push({ method, regex, paramNames, handler });
}

async function handleApi(req, res, pathname, query) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
    try {
      await r.handler(req, res, params, query);
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: 'Loi may chu: ' + e.message });
    }
    return true;
  }
  return false;
}

// ---- ASSETS ----
route('GET', '/api/assets', async (req, res) => {
  const data = db.load();
  sendJson(res, 200, data.assets.map(recalcAsset));
});

route('GET', '/api/assets/by-code/:code', async (req, res, p) => {
  const data = db.load();
  const asset = data.assets.find(a => a.qrCode === p.code);
  if (!asset) return sendJson(res, 404, { error: 'Khong tim thay ma QR nay trong kho' });
  sendJson(res, 200, recalcAsset(asset));
});

route('GET', '/api/assets/:id', async (req, res, p) => {
  const data = db.load();
  const asset = data.assets.find(a => a.id === p.id);
  if (!asset) return sendJson(res, 404, { error: 'Khong tim thay tai san' });
  sendJson(res, 200, recalcAsset(asset));
});

route('POST', '/api/assets', async (req, res) => {
  const b = await readBody(req);
  if (!b.group || !b.model) return sendJson(res, 400, { error: 'Thieu Nhom san pham hoac Model' });
  const data = db.load();
  const importValue = Number(b.importValue) || 0;
  const depreciationPeriod = Number(b.depreciationPeriod) || 0;
  const qrCode = (b.qrCode && String(b.qrCode).trim()) || nextAssetCode(data);
  if (data.assets.find(a => a.qrCode === qrCode)) {
    return sendJson(res, 409, { error: 'Ma QR nay da ton tai, vui long chon ma khac' });
  }
  const asset = {
    id: uuid(),
    qrCode,
    group: b.group || '',
    category: b.category || '',
    brand: b.brand || '',
    model: b.model || '',
    description: b.description || '',
    manufactureDate: b.manufactureDate || '',
    importDate: b.importDate || '',
    importValue,
    depreciationType: b.depreciationType === 'show' ? 'show' : 'month',
    depreciationPeriod,
    depreciationUnitValue: depreciationPeriod > 0 ? round2(importValue / depreciationPeriod) : 0,
    rentalCount: 0,
    totalDepreciated: 0,
    remainingValue: importValue,
    status: 'available',
    createdAt: new Date().toISOString()
  };
  data.assets.push(asset);
  db.save(data);
  sendJson(res, 201, asset);
});

route('PUT', '/api/assets/:id', async (req, res, p) => {
  const b = await readBody(req);
  const data = db.load();
  const asset = data.assets.find(a => a.id === p.id);
  if (!asset) return sendJson(res, 404, { error: 'Khong tim thay tai san' });

  if (b.qrCode && b.qrCode !== asset.qrCode) {
    if (data.assets.find(a => a.qrCode === b.qrCode)) {
      return sendJson(res, 409, { error: 'Ma QR nay da duoc su dung boi tai san khac' });
    }
  }
  const fields = ['qrCode', 'group', 'category', 'brand', 'model', 'description',
    'manufactureDate', 'importDate', 'importValue', 'depreciationType', 'depreciationPeriod', 'status'];
  fields.forEach(f => { if (b[f] !== undefined) asset[f] = b[f]; });
  asset.importValue = Number(asset.importValue) || 0;
  asset.depreciationPeriod = Number(asset.depreciationPeriod) || 0;
  recalcAsset(asset);
  db.save(data);
  sendJson(res, 200, asset);
});

route('DELETE', '/api/assets/:id', async (req, res, p) => {
  const data = db.load();
  data.assets = data.assets.filter(a => a.id !== p.id);
  db.save(data);
  sendJson(res, 200, { ok: true });
});

// ---- RENTALS (Xuat kho / Show) ----
route('GET', '/api/rentals', async (req, res) => {
  const data = db.load();
  const rentals = [...data.rentals].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendJson(res, 200, rentals);
});

route('GET', '/api/rentals/:id', async (req, res, p) => {
  const data = db.load();
  const rental = data.rentals.find(r => r.id === p.id);
  if (!rental) return sendJson(res, 404, { error: 'Khong tim thay show' });
  sendJson(res, 200, rental);
});

route('POST', '/api/rentals', async (req, res) => {
  const b = await readBody(req);
  if (!b.showName || !b.startDateTime || !b.endDateTime) {
    return sendJson(res, 400, { error: 'Thieu Ten show, thoi gian bat dau hoac ket thuc' });
  }
  const data = db.load();
  const rental = {
    id: uuid(),
    code: nextRentalCode(data),
    showName: b.showName,
    customer: b.customer || '',
    location: b.location || '',
    startDateTime: b.startDateTime,
    endDateTime: b.endDateTime,
    status: 'active',
    items: [],
    totalDepreciationValue: 0,
    createdAt: new Date().toISOString()
  };
  data.rentals.push(rental);
  db.save(data);
  sendJson(res, 201, rental);
});

route('POST', '/api/rentals/:id/scan', async (req, res, p) => {
  const b = await readBody(req);
  const data = db.load();
  const rental = data.rentals.find(r => r.id === p.id);
  if (!rental) return sendJson(res, 404, { error: 'Khong tim thay show' });
  if (rental.status !== 'active') return sendJson(res, 400, { error: 'Show nay da dong, khong the them thiet bi' });

  const code = String(b.code || '').trim();
  const asset = data.assets.find(a => a.qrCode === code);
  if (!asset) return sendJson(res, 404, { error: `Khong tim thay thiet bi voi ma QR: ${code}` });

  if (rental.items.find(i => i.assetId === asset.id)) {
    return sendJson(res, 409, { error: `Thiet bi [${asset.qrCode}] ${asset.model} da co trong danh sach cua show nay` });
  }

  recalcAsset(asset);
  let deduction = 0;
  if (asset.depreciationType === 'show') {
    deduction = asset.depreciationUnitValue;
  } else {
    const start = new Date(rental.startDateTime);
    const end = new Date(rental.endDateTime);
    let days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (!days || days < 1) days = 1;
    deduction = round2(asset.depreciationUnitValue * (days / 30));
  }
  const maxAllowed = round2(asset.importValue - asset.totalDepreciated);
  if (deduction > maxAllowed) deduction = maxAllowed;
  if (deduction < 0) deduction = 0;

  asset.rentalCount = (asset.rentalCount || 0) + 1;
  asset.totalDepreciated = round2((asset.totalDepreciated || 0) + deduction);
  asset.remainingValue = round2(asset.importValue - asset.totalDepreciated);
  asset.status = 'rented';

  const item = {
    assetId: asset.id,
    qrCode: asset.qrCode,
    group: asset.group,
    category: asset.category,
    brand: asset.brand,
    model: asset.model,
    depreciationType: asset.depreciationType,
    deductionValue: deduction,
    scannedAt: new Date().toISOString()
  };
  rental.items.push(item);
  rental.totalDepreciationValue = round2(rental.items.reduce((s, i) => s + i.deductionValue, 0));

  db.save(data);
  sendJson(res, 200, { item, rental });
});

route('DELETE', '/api/rentals/:id/items/:assetId', async (req, res, p) => {
  const data = db.load();
  const rental = data.rentals.find(r => r.id === p.id);
  if (!rental) return sendJson(res, 404, { error: 'Khong tim thay show' });
  const idx = rental.items.findIndex(i => i.assetId === p.assetId);
  if (idx === -1) return sendJson(res, 404, { error: 'Khong tim thay thiet bi trong show' });
  const [removed] = rental.items.splice(idx, 1);
  rental.totalDepreciationValue = round2(rental.items.reduce((s, i) => s + i.deductionValue, 0));

  const asset = data.assets.find(a => a.id === removed.assetId);
  if (asset) {
    asset.rentalCount = Math.max(0, (asset.rentalCount || 0) - 1);
    asset.totalDepreciated = round2(Math.max(0, (asset.totalDepreciated || 0) - removed.deductionValue));
    asset.remainingValue = round2(asset.importValue - asset.totalDepreciated);
    if (!rental.items.some(i => i.assetId === asset.id)) asset.status = 'available';
  }
  db.save(data);
  sendJson(res, 200, { ok: true, rental });
});

route('POST', '/api/rentals/:id/close', async (req, res, p) => {
  const data = db.load();
  const rental = data.rentals.find(r => r.id === p.id);
  if (!rental) return sendJson(res, 404, { error: 'Khong tim thay show' });
  rental.status = 'closed';
  db.save(data);
  sendJson(res, 200, rental);
});

route('POST', '/api/rentals/:id/return', async (req, res, p) => {
  const data = db.load();
  const rental = data.rentals.find(r => r.id === p.id);
  if (!rental) return sendJson(res, 404, { error: 'Khong tim thay show' });
  rental.items.forEach(i => {
    const asset = data.assets.find(a => a.id === i.assetId);
    if (asset) asset.status = 'available';
  });
  rental.status = 'returned';
  db.save(data);
  sendJson(res, 200, rental);
});

route('GET', '/api/rentals/:id/export.csv', async (req, res, p) => {
  const data = db.load();
  const rental = data.rentals.find(r => r.id === p.id);
  if (!rental) return sendJson(res, 404, { error: 'Khong tim thay show' });
  const fields = ['qrCode', 'group', 'category', 'brand', 'model', 'depreciationType', 'deductionValue', 'scannedAt'];
  const header = fields.join(',');
  const rows = rental.items.map(item => fields.map(f => csvEscape(item[f])).join(','));
  const csv = [header, ...rows].join('\r\n');
  const body = '﻿' + csv;
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename=${rental.code}.csv`
  });
  res.end(body);
});

// ---------- main server ----------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, pathname, parsed.query);
    if (!handled) sendJson(res, 404, { error: 'Khong tim thay API endpoint' });
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`QR Rental Asset Manager dang chay tai http://localhost:${PORT}`);
});
