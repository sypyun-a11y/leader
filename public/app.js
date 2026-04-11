'use strict';

// ── 별 배경 생성 ──────────────────────────────────────────────
(function createStars() {
  const container = document.getElementById('stars');
  for (let i = 0; i < 120; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.cssText = `
      left: ${Math.random() * 100}%;
      top:  ${Math.random() * 100}%;
      --d: ${(Math.random() * 3 + 2).toFixed(1)}s;
      --max-op: ${(Math.random() * 0.6 + 0.2).toFixed(2)};
      animation-delay: ${(Math.random() * 4).toFixed(1)}s;
    `;
    container.appendChild(star);
  }
})();

// ── 포지션 → CSS 클래스 매핑 ─────────────────────────────────
const POSITION_CLASS = {
  'frontend': 'pos-fe', 'fe': 'pos-fe', '프론트': 'pos-fe', '프론트엔드': 'pos-fe',
  'backend':  'pos-be', 'be': 'pos-be', '백엔드': 'pos-be',
  'ai':       'pos-ai', '인공지능': 'pos-ai', 'ml': 'pos-ai', 'data': 'pos-ai', '데이터': 'pos-ai',
  'devops':   'pos-de', 'de': 'pos-de', 'cloud': 'pos-de', '클라우드': 'pos-de',
};
function posClass(pos) {
  const key = (pos || '').toLowerCase().replace(/\s+/g, '');
  return POSITION_CLASS[key] || 'pos-default';
}

// ── 순위 메달 ─────────────────────────────────────────────────
const MEDALS  = ['🥇', '🥈', '🥉'];
const BADGES  = ['gold', 'silver', 'bronze'];

// ── 오리 이모지 목록 (다양성) ────────────────────────────────
const DUCKS = ['🦆', '🐥', '🐤', '🐣'];
function duckFor(index) { return DUCKS[index % DUCKS.length]; }

// ── 강 건너기 컴포넌트 HTML ──────────────────────────────────
function riverHTML(progress, rowIndex) {
  // 오리는 0~90% 범위에서 이동 (깃발 위치 확보)
  const duckPct = progress * 0.88;
  const duck = duckFor(rowIndex);

  return `
    <div class="river-wrap" data-progress="${progress}" data-duck-pct="${duckPct}">
      <div class="river-fill" style="width:${progress}%"></div>
      <div class="river-waves"></div>
      <div class="river-waves-2"></div>
      <span class="duck" style="left:calc(${duckPct}% - 14px)">${duck}</span>
      <span class="river-flag">🏁</span>
      <span class="river-label">${progress.toFixed(1)}%</span>
    </div>`;
}

// ── 변동 배지 HTML ────────────────────────────────────────────
function changeBadgeHTML(change) {
  if (change > 0) return `<span class="change-badge change-up">▲ ${change}</span>`;
  if (change < 0) return `<span class="change-badge change-down">▼ ${Math.abs(change)}</span>`;
  return `<span class="change-badge change-same">– 0</span>`;
}

// ── 포디움 렌더링 ─────────────────────────────────────────────
function renderPodium(top3) {
  const el = document.getElementById('podium');
  const section = document.getElementById('podium-section');
  if (!top3.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  // 1위를 가운데 배치: 2위, 1위, 3위 순서
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);

  el.innerHTML = order.map(s => `
    <div class="podium-card rank-${s.rank}">
      <span class="podium-medal">${MEDALS[s.rank - 1] || '🏅'}</span>
      <div class="podium-rank-num">${s.rank}위</div>
      <div class="podium-name">${escHtml(s.name)}</div>
      <div class="podium-progress-wrap">
        <div class="podium-progress-label">${s.progress.toFixed(1)}%</div>
        <div class="podium-progress-sub">진도율</div>
      </div>
    </div>
  `).join('');
}

// ── 전체 랭킹 렌더링 ──────────────────────────────────────────
function renderList(data) {
  const list = document.getElementById('leaderboard-list');

  if (!data.length) {
    list.innerHTML = `<div class="error-box">데이터가 없습니다.</div>`;
    return;
  }

  list.innerHTML = data.map((s, i) => `
    <div class="leaderboard-row rank-${s.rank}" style="animation-delay:${i * 0.04}s">
      <div>
        <div class="rank-badge ${BADGES[s.rank - 1] || ''}">${s.rank}</div>
      </div>
      <div class="student-name" title="${escHtml(s.name)}">${escHtml(s.name)}</div>
      <div>${riverHTML(s.progress, i)}</div>
      <div class="score-val">${formatScore(s.score)}</div>
      <div>${changeBadgeHTML(s.change)}</div>
    </div>
  `).join('');

  // 오리 애니메이션: 잠깐 0에서 시작해 최종 위치로 이동
  requestAnimationFrame(() => {
    document.querySelectorAll('.duck').forEach(duck => {
      const wrap = duck.closest('.river-wrap');
      const targetPct = parseFloat(wrap.dataset.duckPct);
      duck.style.left = '0px';
      setTimeout(() => {
        duck.style.left = `calc(${targetPct}% - 14px)`;
      }, 100);
    });
    document.querySelectorAll('.river-fill').forEach(fill => {
      const wrap = fill.closest('.river-wrap');
      const progress = parseFloat(wrap.dataset.progress);
      fill.style.width = '0%';
      setTimeout(() => { fill.style.width = `${progress}%`; }, 100);
    });
  });
}

// ── 유틸 ──────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function formatScore(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return String(val ?? '-');
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}
function formatTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── 데이터 로드 ───────────────────────────────────────────────
async function loadLeaderboard(forceRefresh = false) {
  const btn = document.getElementById('refresh-btn');
  const updatedEl = document.getElementById('last-updated');

  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const url = forceRefresh ? '/api/leaderboard?refresh=1' : '/api/leaderboard';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`서버 오류: ${res.status}`);

    const json = await res.json();
    if (!json.success) throw new Error(json.error || '데이터 로드 실패');

    const data = (json.data || []).slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    renderPodium(data.slice(0, 3));
    renderList(data);

    const cached = json.cached ? ' (캐시)' : '';
    updatedEl.textContent = `마지막 갱신: ${formatTime(json.lastFetched)}${cached}`;
  } catch (err) {
    console.error(err);
    document.getElementById('leaderboard-list').innerHTML =
      `<div class="error-box">
        <p>데이터를 불러오지 못했습니다.</p>
        <p style="font-size:0.8rem;margin-top:0.5rem;color:#94a3b8">${escHtml(err.message)}</p>
      </div>`;
    updatedEl.textContent = '오류 발생';
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ── 자동 갱신 (1분) ──────────────────────────────────────────
loadLeaderboard();
setInterval(() => loadLeaderboard(), 60000);
