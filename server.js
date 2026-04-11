require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const REDASH_API_URL = process.env.REDASH_API_URL;
const REDASH_API_KEY = process.env.REDASH_API_KEY;
const REDASH_QUERY_ID = process.env.REDASH_QUERY_ID;

if (!REDASH_API_URL || !REDASH_API_KEY || !REDASH_QUERY_ID) {
  console.error('Missing required environment variables: REDASH_API_URL, REDASH_API_KEY, REDASH_QUERY_ID');
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public')));

// 이전 순위 캐싱 (변동 계산용)
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
  const columns = response.data?.query_result?.data?.columns || [];

  return { rows, columns };
}

function normalizeRow(row, index) {
  // 컬럼 이름을 유연하게 매핑 (다양한 Redash 쿼리 결과 대응)
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

function computeRankings(rows) {
  const normalized = rows.map((row, i) => normalizeRow(row, i));
  normalized.sort((a, b) => b.progress - a.progress);

  return normalized.map((student, i) => {
    const rank = i + 1;
    let change = 0;

    if (previousRankings) {
      const prev = previousRankings.find(p => p.id === student.id || p.name === student.name);
      if (prev) change = prev.rank - rank;
    }

    return { ...student, rank, change };
  });
}

app.get('/api/leaderboard', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === '1';

    if (!forceRefresh && cachedData && lastFetched && now - lastFetched < CACHE_TTL) {
      return res.json({ success: true, data: cachedData, cached: true, lastFetched });
    }

    const { rows, columns } = await fetchRedashData();

    if (!rows.length) {
      return res.json({ success: true, data: [], cached: false, lastFetched: now });
    }

    const rankings = computeRankings(rows);

    // 다음 갱신을 위해 현재 순위 저장
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    redashUrl: REDASH_API_URL,
    queryId: REDASH_QUERY_ID,
    lastFetched,
    cacheAge: lastFetched ? Date.now() - lastFetched : null,
  });
});

app.listen(PORT, () => {
  console.log(`🦆 Leaderboard server running at http://localhost:${PORT}`);
  console.log(`   Redash: ${REDASH_API_URL} (query #${REDASH_QUERY_ID})`);
});
