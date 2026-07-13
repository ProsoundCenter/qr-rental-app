// db.js - simple JSON-file database. No external dependencies, just Node's fs module.
// Good enough for a single small-business team; data lives in data/db.json (back this file up!).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');

const DEFAULTS = {
  assets: [],
  rentals: [],
  counters: { assetSeq: 0, rentalSeq: 0 }
};

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2));

function load() {
  const raw = fs.readFileSync(FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULTS, parsed);
  } catch (e) {
    console.error('Loi doc db.json, tra ve du lieu mac dinh:', e.message);
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(data) {
  // write atomically-ish: write to temp then rename
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save };
