require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const REDASH_API_URL = process.env.REDASH_API_URL;
const REDASH_API_KEY = process.env.REDASH_API_KEY;
const REDASH_QUERY_ID = process.env.REDASH_QUERY_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_COOKIE_NAME = 'admin_auth_token';
const ADMIN_AUTH_TOKEN = ADMIN_PASSWORD ? crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex') : null;

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
}) : null;

const uploadsDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  },
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (req.path === '/admin.html') return res.status(404).end();
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

if (!REDASH_API_URL || !REDASH_API_KEY || !REDASH_QUERY_ID) {
  console.error('Missing required environment variables: REDASH_API_URL, REDASH_API_KEY, REDASH_QUERY_ID');
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

let previousMetrics = null;
let cachedData = null;
let lastFetched = null;
const CACHE_TTL = parseInt(process.env.REFRESH_INTERVAL) || 60000;

async function fetchRedashData() {
  const url = `${REDASH_API_URL}/api/queries/${REDASH_QUERY_ID}/results.json`;
  const response = await axios.get(url, {
    params: { api_key: REDASH_API_KEY },
    timeout: 15000,
  });
  const rows = response.data?.query_result?.data?.rows || [];
  return { rows };
}

function getProgressLevel(progress) {
  if (progress >= 71) return 'golden';
  if (progress >= 51) return 'duck';
  if (progress >= 11) return 'baby';
  return 'egg';
}

function getRevenueLevel(amount) {
  if (amount >= 1000000) return 'golden';
  if (amount >= 100000) return 'duck';
  if (amount >= 1) return 'baby';
  return 'egg';
}

function levelLabel(level) {
  return {
    egg: '알 🥚',
    baby: '아기 오리 🐣',
    duck: '오리 🦆',
    golden: '황금오리 ✨',
  }[level] || '알 🥚';
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS revenue_submissions (
      id SERIAL PRIMARY KEY,
      student_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      image_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ,
      reviewer TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS missions (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      week INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_submissions (
      id SERIAL PRIMARY KEY,
      student_name TEXT NOT NULL,
      mission_id INTEGER REFERENCES missions(id) ON DELETE CASCADE,
      notes TEXT,
      image_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ,
      reviewer TEXT
    );
  `);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').reduce((acc, cookie) => {
    const [name, value] = cookie.split('=').map(s => s.trim());
    if (!name) return acc;
    acc[name] = value;
    return acc;
  }, {});
}

const STUDENT_AUTH_COOKIE_NAME = 'student_auth_token';

function getStudentAuthToken(studentName, last4) {
  return crypto.createHash('sha256')
    .update(`${String(studentName).trim().toLowerCase()}:${String(last4).slice(-4)}`)
    .digest('hex');
}

async function getStudentRowByName(studentName) {
  const { rows } = await fetchRedashData();
  const lowerName = String(studentName).trim().toLowerCase();
  return rows.map((row, i) => normalizeRow(row, i))
    .find(student => String(student.name).trim().toLowerCase() === lowerName);
}

async function isStudentAuthenticated(req, studentName) {
  const cookies = parseCookies(req);
  const token = cookies[STUDENT_AUTH_COOKIE_NAME];
  if (!token || !studentName) return false;
  const studentRow = await getStudentRowByName(studentName);
  if (!studentRow?.dateOfBirth) return false;
  const last4 = String(studentRow.dateOfBirth).replace(/\D/g, '').slice(-4);
  return token === getStudentAuthToken(studentName, last4);
}

function isAdminAuthenticated(req) {
  if (!ADMIN_AUTH_TOKEN) return false;
  const cookies = parseCookies(req);
  return cookies[ADMIN_COOKIE_NAME] === ADMIN_AUTH_TOKEN;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_AUTH_TOKEN) {
    return res.status(503).json({ success: false, error: 'ADMIN_PASSWORD is not configured' });
  }
  if (!isAdminAuthenticated(req)) {
    if (req.path === '/admin' || req.path === '/admin/login') {
      return res.redirect('/admin/login');
    }
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

function normalizeRow(row, index) {
  const normalizedKeys = Object.keys(row).reduce((acc, key) => {
    acc[key.toLowerCase()] = key;
    return acc;
  }, {});

  const findKey = (...candidates) => {
    const lowerKeys = Object.keys(row).map(k => k.toLowerCase());
    for (const candidate of candidates) {
      const target = candidate.toLowerCase();
      const exact = lowerKeys.find(k => k === target);
      if (exact) return normalizedKeys[exact];
      const partial = lowerKeys.find(k => k.includes(target));
      if (partial) return normalizedKeys[partial];
    }
    return undefined;
  };

  const safeNumber = value => {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).replace(/,/g, '').replace(/%/g, '').trim();
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : null;
  };

  const progressRaw = findKey('progress_rate', 'progress', 'rate', '진도율', '완료율', 'completion_rate');
  const progressValue = progressRaw ? safeNumber(row[progressRaw]) : null;
  const scoreRaw = findKey('score', 'total_score', '점수', 'points');
  const scoreValue = scoreRaw ? safeNumber(row[scoreRaw]) : null;
  const progress = progressValue !== null ? progressValue : (scoreValue !== null ? scoreValue : 0);

  const idKey = findKey('id', 'student_id', 'user_id');
  const nameKey = findKey('name', 'student_name', 'user_name', '이름', 'username');
  const positionKey = findKey('position', 'track', 'course', '포지션', '트랙', 'camp', 'cohort');
  const dobKey = findKey('date_of_birth', 'birth_date', 'dob', '생년월일');
  const phoneKey = findKey(
    'phone', 'phone_number', 'mobile', 'mobile_phone', 'phone_no', 'mobile_no',
    'handphone', 'tel', 'tel_number', 'contact', 'contact_number',
    '전화번호', '핸드폰', '휴대폰', '연락처'
  );
  const rawDob = dobKey ? String(row[dobKey] || '').trim() : null;
  let rawPhone = phoneKey ? String(row[phoneKey] || '').trim() : null;
  if (!rawPhone) {
    const fallbackPhoneEntry = Object.entries(row).find(([key, value]) => {
      return /tel|phone|hp|mobile|contact|핸드폰|휴대폰|연락처|번호/i.test(key) &&
        String(value || '').replace(/\D/g, '').length >= 8;
    });
    rawPhone = fallbackPhoneEntry ? String(fallbackPhoneEntry[1] || '').trim() : null;
  }

  return {
    id: idKey ? row[idKey] : index,
    name: nameKey ? row[nameKey] : `수강생 ${index + 1}`,
    position: positionKey ? row[positionKey] : '미분류',
    progress: Math.min(100, Math.max(0, progress)),
    score: scoreValue !== null ? scoreValue : progress,
    dateOfBirth: rawDob || null,
    phone: rawPhone || null,
  };
}

function getRevenuePoints(amount) {
  if (amount >= 1000000) return 100;
  if (amount >= 100000) return 30;
  if (amount >= 1) return 10;
  return 0;
}

async function getRevenueTotals(names) {
  if (!pool || !names?.length) return {};
  const lowerNames = names.map(n => String(n).trim().toLowerCase());
  const res = await pool.query(`
    SELECT lower(student_name) AS student_name, COALESCE(SUM(amount), 0) AS total_amount
    FROM revenue_submissions
    WHERE lower(student_name) = ANY($1) AND status = 'approved'
    GROUP BY lower(student_name)
  `, [lowerNames]);
  return res.rows.reduce((acc, row) => {
    acc[row.student_name] = parseInt(row.total_amount, 10) || 0;
    return acc;
  }, {});
}

async function getMissionStats(names) {
  if (!pool || !names?.length) return {};
  const lowerNames = names.map(n => String(n).trim().toLowerCase());
  const res = await pool.query(`
    SELECT lower(ms.student_name) AS student_name,
      COUNT(*) FILTER (WHERE ms.status = 'approved') AS approved_count,
      COUNT(DISTINCT CASE WHEN ms.status = 'approved' THEN COALESCE(m.week, 0) END) AS approved_week_count
    FROM mission_submissions ms
    LEFT JOIN missions m ON m.id = ms.mission_id
    WHERE lower(ms.student_name) = ANY($1)
    GROUP BY lower(ms.student_name)
  `, [lowerNames]);
  return res.rows.reduce((acc, row) => {
    acc[row.student_name] = {
      approvedCount: parseInt(row.approved_count, 10) || 0,
      approvedWeekCount: parseInt(row.approved_week_count, 10) || 0,
    };
    return acc;
  }, {});
}

function invalidateLeaderboardCache() {
  cachedData = null;
}

function computeMvp(rankings) {
  if (!rankings?.length) return null;
  const candidate = rankings.reduce((best, student) => {
    const mvpScore = (student.progressScore || 0) + (student.revenueScore || 0);
    if (!best || mvpScore > best.mvpScore) {
      return { ...student, mvpScore };
    }
    return best;
  }, null);
  if (!candidate) return null;
  return {
    name: candidate.name,
    mvpScore: candidate.mvpScore,
    progressScore: candidate.progressScore || 0,
    revenueScore: candidate.revenueScore || 0,
    missionPoints: candidate.missionPoints || 0,
    progressLevel: candidate.progressLevel,
  };
}

async function fetchLeaderboardData() {
  const { rows } = await fetchRedashData();
  const normalized = rows.map((row, i) => normalizeRow(row, i));
  const names = normalized.map(item => String(item.name).trim().toLowerCase());
  const revenueTotals = await getRevenueTotals(names);
  const missionStats = await getMissionStats(names);

  const ranked = normalized.map(student => {
    const lowerName = String(student.name).trim().toLowerCase();
    const revenueTotal = revenueTotals[lowerName] || 0;
    const missionData = missionStats[lowerName] || { approvedCount: 0, approvedWeekCount: 0 };
    const progressScore = Math.floor(Math.min(100, Math.max(0, student.progress)) / 10) * 10;
    const missionPoints = missionData.approvedWeekCount * 10;
    const revenueScore = getRevenuePoints(revenueTotal);
    const totalScore = progressScore + missionPoints + revenueScore;
    return {
      ...student,
      progressScore,
      missionPoints,
      missionApprovedCount: missionData.approvedCount,
      missionWeekCount: missionData.approvedWeekCount,
      revenueTotal,
      revenueScore,
      totalScore,
      progressLevel: getProgressLevel(student.progress),
      revenueLevel: getRevenueLevel(revenueTotal),
    };
  });

  ranked.sort((a, b) => {
    if (b.progress !== a.progress) return b.progress - a.progress;
    return a.name.localeCompare(b.name, 'ko');
  });

  const previousMap = (previousMetrics || []).reduce((acc, row) => {
    acc[String(row.name).trim().toLowerCase()] = row.progress;
    return acc;
  }, {});

  const result = ranked.map((student, index) => {
    const currentRank = index + 1;
    const previousRankProgress = previousMap[String(student.name).trim().toLowerCase()];
    const progressGain = previousRankProgress !== undefined ? student.progress - previousRankProgress : 0;
    return {
      ...student,
      rank: currentRank,
      progressGain: Math.round(progressGain * 10) / 10,
    };
  });

  return result;
}

app.get('/api/leaderboard', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh && cachedData && lastFetched && now - lastFetched < CACHE_TTL) {
      const mvp = computeMvp(cachedData);
      return res.json({ success: true, data: cachedData, mvp, cached: true, lastFetched });
    }
    const rankings = await fetchLeaderboardData();
    previousMetrics = rankings.map(r => ({ name: String(r.name).trim().toLowerCase(), progress: r.progress }));
    cachedData = rankings;
    lastFetched = now;
    const mvp = computeMvp(rankings);
    res.json({ success: true, data: rankings, mvp, cached: false, lastFetched });
  } catch (err) {
    console.error('Redash fetch error:', err.message);
    if (cachedData) {
      return res.json({ success: true, data: cachedData, cached: true, lastFetched, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/student/:name', async (req, res) => {
  const studentName = String(req.params.name || '').trim();
  if (!studentName) return res.status(400).json({ success:false, error:'name parameter required' });
  const authenticatedStudent = await isStudentAuthenticated(req, studentName);
  if (!authenticatedStudent && !isAdminAuthenticated(req)) {
    return res.status(401).json({ success:false, error:'로그인이 필요합니다.' });
  }

  const lowerName = studentName.toLowerCase();
  const leaderboardRes = await fetchRedashData();
  const studentRow = leaderboardRes.rows.map((row, i) => normalizeRow(row, i))
    .find(student => String(student.name).trim().toLowerCase() === lowerName);
  const progress = studentRow ? Math.min(100, Math.max(0, studentRow.progress)) : 0;
  const progressLevel = getProgressLevel(progress);
  const progressScore = Math.floor(progress / 10) * 10;

  let revenueSubmissions = [];
  let revenueTotal = 0;
  let revenueLevel = getRevenueLevel(0);
  let revenueScore = 0;
  let missionApprovedCount = 0;
  let missionWeekCount = 0;
  let missionPoints = 0;
  let missions = [];
  const dbConfigured = Boolean(pool);

  if (pool) {
    const revenueRes = await pool.query(
      `SELECT * FROM revenue_submissions WHERE lower(student_name) = $1 ORDER BY submitted_at DESC`,
      [lowerName]
    );
    const revenueSummaryRes = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total_amount, COUNT(*) FILTER (WHERE status='approved') AS approved_count
       FROM revenue_submissions
       WHERE lower(student_name) = $1`,
      [lowerName]
    );
    revenueSubmissions = revenueRes.rows;
    revenueTotal = parseInt(revenueSummaryRes.rows[0].total_amount,10) || 0;
    revenueLevel = getRevenueLevel(revenueTotal);
    revenueScore = getRevenuePoints(revenueTotal);

    const missionSummaryRes = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE ms.status='approved') AS approved_count,
              COUNT(DISTINCT CASE WHEN ms.status='approved' THEN COALESCE(m.week,0) END) AS approved_week_count
       FROM mission_submissions ms
       LEFT JOIN missions m ON m.id = ms.mission_id
       WHERE lower(ms.student_name) = $1`,
      [lowerName]
    );
    missionApprovedCount = parseInt(missionSummaryRes.rows[0].approved_count,10) || 0;
    missionWeekCount = parseInt(missionSummaryRes.rows[0].approved_week_count,10) || 0;
    missionPoints = missionWeekCount * 10;

    const missionsRes = await pool.query(
      `SELECT m.id, m.title, m.description, m.week,
              ms.id AS submission_id, ms.status AS submission_status, ms.notes, ms.image_path, ms.submitted_at, ms.reviewed_at
       FROM missions m
       LEFT JOIN mission_submissions ms ON ms.mission_id = m.id AND lower(ms.student_name) = $1
       ORDER BY m.week ASC, m.id ASC`,
      [lowerName]
    );
    missions = missionsRes.rows;
  }

  res.json({
    success:true,
    data: {
      studentName,
      progress,
      progressLevel,
      progressScore,
      revenueTotal,
      revenueLevel,
      revenueScore,
      missionApprovedCount,
      missionWeekCount,
      missionPoints,
      phone: studentRow?.phone || null,
      revenueSubmissions,
      missions,
      dbConfigured,
    }
  });
});

app.post('/api/student/:name/auth', async (req, res) => {
  const studentName = String(req.params.name || '').trim();
  const code = String(req.body.code || '').trim();
  if (!studentName) return res.status(400).json({ success:false, error:'name parameter required' });
  if (!/^[0-9]{4}$/.test(code)) return res.status(400).json({ success:false, error:'생년월일 4자리를 입력해주세요.' });

  const studentRow = await getStudentRowByName(studentName);
  if (!studentRow || !studentRow.dateOfBirth) {
    return res.status(400).json({ success:false, error:'학생 정보를 확인할 수 없습니다.' });
  }

  const last4 = String(studentRow.dateOfBirth).replace(/\D/g, '').slice(-4);
  if (last4 !== code) {
    return res.status(401).json({ success:false, error:'비밀번호가 일치하지 않습니다.' });
  }

  const token = getStudentAuthToken(studentName, last4);
  res.setHeader('Set-Cookie', `${STUDENT_AUTH_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=86400`);
  res.json({ success:true });
});

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '').trim();
  if (!ADMIN_PASSWORD) return res.status(503).json({ success:false, error:'관리자 비밀번호가 설정되지 않았습니다.' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success:false, error:'비밀번호가 일치하지 않습니다.' });
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${ADMIN_AUTH_TOKEN}; HttpOnly; Path=/; Max-Age=86400`);
  res.json({ success:true });
});

app.get('/student/:name', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.post('/api/earnings/submit', upload.single('receipt'), async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const studentName = String(req.body.studentName || '').trim();
  const amount = parseInt(req.body.amount, 10);
  if (!studentName || isNaN(amount) || amount < 0) {
    return res.status(400).json({ success:false, error:'이름과 수익 금액을 정확히 입력해주세요.' });
  }
  const imagePath = req.file ? `uploads/${req.file.filename}` : null;
  await pool.query(
    'INSERT INTO revenue_submissions (student_name, amount, image_path) VALUES ($1,$2,$3)',
    [studentName, amount, imagePath]
  );
  res.json({ success:true });
});

app.get('/api/earnings/summary', async (req, res) => {
  const studentName = String(req.query.name || '').trim();
  if (!studentName) return res.status(400).json({ success:false, error:'name parameter required' });
  if (!pool) {
    return res.json({
      success:true,
      data:{
        studentName,
        revenueTotal:0,
        revenueLevel:getRevenueLevel(0),
        revenueScore:0,
        missionApprovedCount:0,
        missionWeekCount:0,
        missionPoints:0,
        totalPoints:0,
        dbConfigured:false,
      }
    });
  }
  const lowerName = studentName.toLowerCase();
  const revenueRes = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total_amount, COUNT(*) FILTER (WHERE status='approved') AS approved_count
     FROM revenue_submissions
     WHERE lower(student_name) = $1`,
    [lowerName]
  );
  const missionRes = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE ms.status='approved') AS approved_count,
            COUNT(DISTINCT CASE WHEN ms.status='approved' THEN COALESCE(m.week,0) END) AS approved_week_count
     FROM mission_submissions ms
     LEFT JOIN missions m ON m.id = ms.mission_id
     WHERE lower(ms.student_name) = $1`,
    [lowerName]
  );
  const revenueTotal = parseInt(revenueRes.rows[0].total_amount,10) || 0;
  const revenueLevel = getRevenueLevel(revenueTotal);
  const missionApprovedCount = parseInt(missionRes.rows[0].approved_count,10) || 0;
  const missionWeekCount = parseInt(missionRes.rows[0].approved_week_count,10) || 0;
  const revenueScore = getRevenuePoints(revenueTotal);
  const missionPoints = missionWeekCount * 10;
  res.json({
    success:true,
    data:{
      studentName,
      revenueTotal,
      revenueLevel,
      revenueScore,
      missionApprovedCount,
      missionWeekCount,
      missionPoints,
      totalPoints: revenueScore + missionPoints,
      dbConfigured:true,
    }
  });
});

app.get('/api/earnings/submissions', async (req, res) => {
  if (!pool) {
    return res.json({ success:true, data: [] });
  }
  const studentName = String(req.query.name || '').trim();
  const params = [];
  let query = 'SELECT * FROM revenue_submissions';
  if (studentName) {
    query += ' WHERE lower(student_name) = $1';
    params.push(studentName.toLowerCase());
  }
  query += ' ORDER BY submitted_at DESC';
  const result = await pool.query(query, params);
  res.json({ success:true, data: result.rows });
});

app.get('/api/missions', async (req, res) => {
  if (!pool) {
    return res.json({ success:true, data: [] });
  }
  const result = await pool.query('SELECT * FROM missions ORDER BY week ASC, id ASC');
  res.json({ success:true, data: result.rows });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=deleted; HttpOnly; Path=/; Max-Age=0`);
  res.json({ success:true });
});

app.use('/api/admin', requireAdmin);

app.post('/api/mission-submissions', upload.single('receipt'), async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const studentName = String(req.body.studentName || '').trim();
  const missionId = parseInt(req.body.missionId, 10);
  const notes = String(req.body.notes || '').trim();
  if (!studentName || isNaN(missionId)) return res.status(400).json({ success:false, error:'이름과 미션을 선택해주세요.' });
  const imagePath = req.file ? `uploads/${req.file.filename}` : null;
  await pool.query(
    'INSERT INTO mission_submissions (student_name, mission_id, notes, image_path) VALUES ($1,$2,$3,$4)',
    [studentName, missionId, notes, imagePath]
  );
  res.json({ success:true });
});

app.get('/api/mission-submissions', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const studentName = String(req.query.name || '').trim();
  const params = [];
  let query = `
    SELECT ms.*, m.title AS mission_title
    FROM mission_submissions ms
    LEFT JOIN missions m ON m.id = ms.mission_id`;
  if (studentName) {
    query += ' WHERE lower(ms.student_name) = $1';
    params.push(studentName.toLowerCase());
  }
  query += ' ORDER BY ms.submitted_at DESC';
  const result = await pool.query(query, params);
  res.json({ success:true, data: result.rows });
});

app.get('/api/admin/revenue-submissions', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const result = await pool.query('SELECT * FROM revenue_submissions ORDER BY submitted_at DESC');
  res.json({ success:true, data: result.rows });
});

app.post('/api/admin/revenue-submissions/:id/:action(approve|approved|reject|rejected)', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const id = parseInt(req.params.id, 10);
  const action = String(req.params.action || '').toLowerCase();
  const status = action.startsWith('approve') ? 'approved' : 'rejected';
  await pool.query('UPDATE revenue_submissions SET status = $1, reviewed_at = now(), reviewer = $2 WHERE id = $3', [status,'admin',id]);
  invalidateLeaderboardCache();
  res.json({ success:true });
});

app.get('/api/admin/mission-submissions', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const result = await pool.query(`
    SELECT ms.*, m.title AS mission_title
    FROM mission_submissions ms
    LEFT JOIN missions m ON m.id = ms.mission_id
    ORDER BY ms.submitted_at DESC
  `);
  res.json({ success:true, data: result.rows });
});

app.post('/api/admin/mission-submissions/:id/:action(approve|approved|reject|rejected)', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const id = parseInt(req.params.id, 10);
  const action = String(req.params.action || '').toLowerCase();
  const status = action.startsWith('approve') ? 'approved' : 'rejected';
  await pool.query('UPDATE mission_submissions SET status = $1, reviewed_at = now(), reviewer = $2 WHERE id = $3', [status,'admin',id]);
  invalidateLeaderboardCache();
  res.json({ success:true });
});

app.get('/api/admin/missions', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const result = await pool.query('SELECT * FROM missions ORDER BY week ASC, id ASC');
  res.json({ success:true, data: result.rows });
});

app.post('/api/admin/missions', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const week = parseInt(req.body.week, 10);
  if (!title) return res.status(400).json({ success:false, error:'미션 제목을 입력해주세요.' });
  await pool.query('INSERT INTO missions (title, description, week) VALUES ($1,$2,$3)', [title, description, isNaN(week) ? null : week]);
  invalidateLeaderboardCache();
  res.json({ success:true });
});

app.get('/admin/login', (req, res) => {
  if (isAdminAuthenticated(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/admin', (req, res) => {
  if (!isAdminAuthenticated(req)) return res.redirect('/admin/login');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    redashUrl: REDASH_API_URL,
    queryId: REDASH_QUERY_ID,
    lastFetched,
    cacheAge: lastFetched ? Date.now() - lastFetched : null,
  });
});

initDb().catch(err => {
  console.error('Database initialization failed:', err);
});

app.listen(PORT, () => {
  console.log(`🦆 Leaderboard server running at http://localhost:${PORT}`);
  console.log(`   Redash: ${REDASH_API_URL} (query #${REDASH_QUERY_ID})`);
});
