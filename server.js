require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const REDASH_API_URL = process.env.REDASH_API_URL;
const REDASH_API_KEY = process.env.REDASH_API_KEY;
const REDASH_QUERY_ID = process.env.REDASH_QUERY_ID;
const DATABASE_URL = process.env.DATABASE_URL;

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
app.use(express.static(path.join(__dirname, 'public')));

if (!REDASH_API_URL || !REDASH_API_KEY || !REDASH_QUERY_ID) {
  console.error('Missing required environment variables: REDASH_API_URL, REDASH_API_KEY, REDASH_QUERY_ID');
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

let previousRankings = null;
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
  if (progress >= 100) return 'golden';
  if (progress >= 60) return 'duck';
  if (progress >= 30) return 'baby';
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
    egg: '🥚 알',
    baby: '🐣 아기오리',
    duck: '🦆 오리',
    golden: '🦆✨ 황금오리',
  }[level] || '🥚 알';
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

  return {
    id: idKey ? row[idKey] : index,
    name: nameKey ? row[nameKey] : `수강생 ${index + 1}`,
    position: positionKey ? row[positionKey] : '미분류',
    progress: Math.min(100, Math.max(0, progress)),
    score: scoreValue !== null ? scoreValue : progress,
  };
}

async function getBonusMap(names) {
  if (!pool || !names?.length) return {};
  const lowerNames = names.map(n => String(n).trim().toLowerCase());
  const res = await pool.query(`
    SELECT student_name, SUM(points) AS bonus
    FROM (
      SELECT lower(student_name) AS student_name, CASE WHEN status = 'approved' THEN 10 ELSE 0 END AS points
      FROM revenue_submissions
      WHERE lower(student_name) = ANY($1)
      UNION ALL
      SELECT lower(student_name) AS student_name, CASE WHEN status = 'approved' THEN 10 ELSE 0 END AS points
      FROM mission_submissions
      WHERE lower(student_name) = ANY($1)
    ) t
    GROUP BY student_name
  `, [lowerNames]);
  return res.rows.reduce((acc, row) => {
    acc[row.student_name] = parseInt(row.bonus, 10) || 0;
    return acc;
  }, {});
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

async function fetchLeaderboardData() {
  const { rows } = await fetchRedashData();
  const normalized = rows.map((row, i) => normalizeRow(row, i));
  const names = normalized.map(item => String(item.name).trim().toLowerCase());
  const bonusMap = await getBonusMap(names);
  const revenueTotals = await getRevenueTotals(names);

  const ranked = normalized.map(student => {
    const lowerName = String(student.name).trim().toLowerCase();
    const bonusPoints = bonusMap[lowerName] || 0;
    const revenueTotal = revenueTotals[lowerName] || 0;
    const totalScore = student.score + bonusPoints;
    return {
      ...student,
      bonusPoints,
      revenueTotal,
      totalScore,
      progressLevel: getProgressLevel(student.progress),
      revenueLevel: getRevenueLevel(revenueTotal),
    };
  });

  ranked.sort((a,b) => {
    if (b.progress !== a.progress) return b.progress - a.progress;
    return b.totalScore - a.totalScore;
  });

  return ranked.map((student, index) => ({ ...student, rank: index + 1 }));
}

app.get('/api/leaderboard', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh && cachedData && lastFetched && now - lastFetched < CACHE_TTL) {
      return res.json({ success: true, data: cachedData, cached: true, lastFetched });
    }
    const rankings = await fetchLeaderboardData();
    previousRankings = rankings.map(r => ({ id: r.id, name: r.name, rank: r.rank }));
    cachedData = rankings;
    lastFetched = now;
    res.json({ success: true, data: rankings, cached: false, lastFetched });
  } catch (err) {
    console.error('Redash fetch error:', err.message);
    if (cachedData) {
      return res.json({ success: true, data: cachedData, cached: true, lastFetched, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
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
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const studentName = String(req.query.name || '').trim();
  if (!studentName) return res.status(400).json({ success:false, error:'name parameter required' });
  const lowerName = studentName.toLowerCase();
  const revenueRes = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total_amount, COUNT(*) FILTER (WHERE status='approved') AS approved_count
     FROM revenue_submissions
     WHERE lower(student_name) = $1`,
    [lowerName]
  );
  const missionRes = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status='approved') AS approved_count
     FROM mission_submissions
     WHERE lower(student_name) = $1`,
    [lowerName]
  );
  const revenueTotal = parseInt(revenueRes.rows[0].total_amount,10) || 0;
  const revenueLevel = getRevenueLevel(revenueTotal);
  const points = (parseInt(revenueRes.rows[0].approved_count,10) || 0) * 10 + (parseInt(missionRes.rows[0].approved_count,10) || 0) * 10;
  res.json({ success:true, data:{ studentName, revenueTotal, revenueLevel, points } });
});

app.get('/api/earnings/submissions', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
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
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const result = await pool.query('SELECT * FROM missions ORDER BY week ASC, id ASC');
  res.json({ success:true, data: result.rows });
});

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

app.post('/api/admin/revenue-submissions/:id/approve', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const id = parseInt(req.params.id, 10);
  await pool.query('UPDATE revenue_submissions SET status = $1, reviewed_at = now(), reviewer = $2 WHERE id = $3', ['approved','admin',id]);
  res.json({ success:true });
});

app.post('/api/admin/revenue-submissions/:id/reject', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const id = parseInt(req.params.id, 10);
  await pool.query('UPDATE revenue_submissions SET status = $1, reviewed_at = now(), reviewer = $2 WHERE id = $3', ['rejected','admin',id]);
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

app.post('/api/admin/mission-submissions/:id/approve', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const id = parseInt(req.params.id, 10);
  await pool.query('UPDATE mission_submissions SET status = $1, reviewed_at = now(), reviewer = $2 WHERE id = $3', ['approved','admin',id]);
  res.json({ success:true });
});

app.post('/api/admin/mission-submissions/:id/reject', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, error:'Database not configured' });
  const id = parseInt(req.params.id, 10);
  await pool.query('UPDATE mission_submissions SET status = $1, reviewed_at = now(), reviewer = $2 WHERE id = $3', ['rejected','admin',id]);
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
  res.json({ success:true });
});

app.get('/admin', (req, res) => {
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
