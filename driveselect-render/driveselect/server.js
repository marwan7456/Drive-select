'use strict';
/*
 * DriveSelect back end.
 * Zero dependencies (Node built-ins only), so Render needs no npm install.
 * Serves the front end from /public and a JSON API at /api/records.
 * Records are kept in data/records.json.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 20 * 1024;

const MAKES = ['Toyota', 'Ford', 'BMW', 'Honda', 'Nissan', 'Kia', 'Other'];
const TYPES = ['Service', 'Repair', 'MOT'];
const WORK = ['Oil change', 'Brakes', 'Tyres', 'Battery'];
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- storage ---------- */
let db = { nextId: 1, records: [] };

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function demoRecords() {
  const rows = [
    ['Sara Ahmed', 'AB12 CDE', 'Toyota', 42150, 2, 'Service', '', ['Oil change']],
    ['Omar Khalil', 'KX19 TRP', 'BMW', 68300, 5, 'Repair', 'Squealing brakes at low speed.', ['Brakes']],
    ['Mona Hassan', 'LM70 QWE', 'Kia', 15890, 9, 'MOT', '', []],
    ['Youssef Ali', 'GH65 ZXC', 'Ford', 98710, 14, 'Repair', 'Battery not holding charge.', ['Battery']],
    ['Laila Farouk', 'RT21 BNM', 'Honda', 30420, 20, 'Service', '', ['Oil change', 'Tyres']],
    ['Karim Nabil', 'PQ18 HJK', 'Nissan', 77215, 27, 'MOT', '', []],
    ['Nour Samir', 'DF22 VBN', 'Toyota', 8800, 33, 'Service', '', ['Oil change']],
    ['Hany Adel', 'WS17 UIO', 'Other', 120500, 41, 'Repair', 'Front left tyre puncture.', ['Tyres']],
    ['Dina Mostafa', 'YU20 ERT', 'BMW', 54600, 48, 'Service', '', ['Oil change', 'Brakes']],
    ['Tamer Fathy', 'ZX16 LKJ', 'Ford', 143900, 56, 'MOT', '', []]
  ];
  return rows.map(([customer, reg, make, mileage, ago, type, fault, work], i) => ({
    id: i + 1, customer, reg, make, mileage, date: daysAgo(ago), type, fault, work, notes: '',
    createdAt: new Date().toISOString()
  }));
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const records = demoRecords();
    db = { nextId: records.length + 1, records };
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return;
  }
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!db || !Array.isArray(db.records)) throw new Error('data/records.json is not in the expected format');
  if (!Number.isInteger(db.nextId)) db.nextId = db.records.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

let queue = Promise.resolve();
function persist() {
  const run = queue.then(async () => {
    const tmp = DATA_FILE + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.promises.rename(tmp, DATA_FILE);
  });
  queue = run.catch(() => {});
  return run;
}

/* ---------- validation (same rules as the form) ---------- */
function validate(b) {
  const errors = {};
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const customer = s(b.customer).slice(0, 100);
  const reg = s(b.reg).toUpperCase();
  const make = s(b.make);
  const mileage = s(String(b.mileage ?? ''));
  const date = s(b.date);
  const type = s(b.type);
  const fault = s(b.fault).slice(0, 1000);
  const notes = s(b.notes).slice(0, 1000);
  const work = (Array.isArray(b.work) ? b.work : []).filter((w) => WORK.includes(w));

  if (!customer) errors.customer = 'Enter the customer name.';
  if (!/^[A-Z0-9 ]{2,8}$/.test(reg)) errors.reg = 'Enter a registration plate of 2 to 8 letters or numbers.';
  if (!MAKES.includes(make)) errors.make = 'Choose the car make.';
  if (!/^\d{1,6}$/.test(mileage)) errors.mileage = 'Enter the mileage as a whole number between 0 and 999999.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Choose the date of work.';
  else if (date > today()) errors.date = 'The date of work cannot be in the future.';
  if (!TYPES.includes(type)) errors.type = 'Choose a job type.';
  if (type === 'Repair' && !fault) errors.fault = 'Describe the fault for this repair.';

  return {
    errors,
    clean: { customer, reg, make, mileage: Number(mileage), date, type, fault: type === 'Repair' ? fault : '', work, notes }
  };
}

/* ---------- helpers ---------- */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('The request body is not valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'records', id?]
  const method = req.method;

  if (parts[1] === 'health' && method === 'GET') return sendJson(res, 200, { ok: true });
  if (parts[1] !== 'records') return sendJson(res, 404, { message: 'Not found.' });

  if (parts.length === 2) {
    if (method === 'GET') return sendJson(res, 200, db.records);
    if (method === 'POST') {
      const { errors, clean } = validate(await readBody(req));
      if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Some fields need correcting.', errors });
      const rec = { id: db.nextId++, ...clean, createdAt: new Date().toISOString() };
      db.records.push(rec);
      await persist();
      return sendJson(res, 201, rec);
    }
    return sendJson(res, 405, { message: 'Method not allowed.' });
  }

  if (parts.length === 3) {
    const id = Number(parts[2]);
    const rec = db.records.find((r) => r.id === id);
    if (!rec) return sendJson(res, 404, { message: 'Record not found.' });
    if (method === 'GET') return sendJson(res, 200, rec);
    if (method === 'DELETE') {
      db.records = db.records.filter((r) => r.id !== id);
      await persist();
      return sendJson(res, 200, { deleted: id });
    }
  }
  return sendJson(res, 405, { message: 'Method not allowed.' });
}

/* ---------- static files ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- server ---------- */
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { message: status === 500 ? 'Something went wrong on the server.' : err.message });
    }
  });
}

if (require.main === module) {
  loadDb();
  createServer().listen(PORT, HOST, () => console.log('DriveSelect running at http://' + HOST + ':' + PORT));
}

module.exports = { createServer, loadDb };
