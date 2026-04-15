'use strict';

(function createStars() {
  const container = document.getElementById('stars');
  if (!container) return;
  for (let i = 0; i < 120; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.cssText = `
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      --d: ${(Math.random() * 3 + 2).toFixed(1)}s;
      --max-op: ${(Math.random() * 0.6 + 0.2).toFixed(2)};
      animation-delay: ${(Math.random() * 4).toFixed(1)}s;
    `;
    container.appendChild(star);
  }
})();

const MEDALS = ['🥇', '🥈', '🥉'];
const BADGES = ['gold', 'silver', 'bronze'];

function spartaImageFor(progress) {
  if (progress <= 25) return '/sparta1.png';
  if (progress <= 50) return '/sparta2.png';
  if (progress <= 75) return '/sparta3.png';
  return '/sparta4.png';
}

function riverHTML(progress, rowIndex) {
  const duckPct = progress * 0.88;
  const imageSrc = spartaImageFor(progress);
  return `
    <div class="river-group">
      <div class="river-wrap" data-progress="${progress}" data-duck-pct="${duckPct}">
        <div class="river-fill" style="width:${progress}%"></div>
        <div class="river-waves"></div>
        <div class="river-waves-2"></div>
        <span class="duck" style="left:calc(${duckPct}% - 14px)">
          <img src="${imageSrc}" alt="스파르탄 캐릭터" />
        </span>
        <span class="river-flag">🏁</span>
      </div>
      <span class="river-label">${progress.toFixed(1)}%</span>
    </div>`;
}

function changeBadgeHTML(change) {
  if (change > 0) return `<span class="change-badge change-up">▲ ${change}</span>`;
  if (change < 0) return `<span class="change-badge change-down">▼ ${Math.abs(change)}</span>`;
  return `<span class="change-badge change-same">– 0</span>`;
}

function levelLabel(value) {
  const score = parseFloat(value);
  if (Number.isNaN(score)) return '🛡️ 신병';
  if (score <= 25) return '🛡️ 신병';
  if (score <= 50) return '⚔️ 병사';
  if (score <= 75) return '🏹 전사';
  return '👑 스파르탄';
}

function scoreClass(scoreValue) {
  const score = parseFloat(scoreValue);
  if (Number.isNaN(score)) return '';
  if (score >= 90) return 'score-val--high';
  if (score >= 75) return 'score-val--mid';
  return 'score-val--normal';
}

function renderMvp(mvp) {
  const container = document.getElementById('mvp-content');
  if (!container) return;
  if (!mvp) {
    container.innerHTML = '<p class="field-note">이번 주 MVP 정보를 불러올 수 없습니다.</p>';
    return;
  }
  container.innerHTML = `
    <div class="mvp-card-inner">
      <div><strong>${escHtml(mvp.name)}</strong>님이 이번 주 최고 점수입니다.</div>
      <div class="field-note">총점 (진도+수익): ${formatScore(mvp.mvpScore)}점</div>
      <div class="field-note">진도 점수: ${formatScore(mvp.progressScore)}점</div>
      <div class="field-note">수익 점수: ${formatScore(mvp.revenueScore)}점</div>
      <div class="field-note">미션 추가 점수: ${formatScore(mvp.missionPoints)}점</div>
    </div>
  `;
}

const FORTUNE_MESSAGES = [
  '오늘의 선택이 내일의 경쟁력을 만듭니다.',
  '작은 실천 하나가 큰 기회를 불러옵니다.',
  '동료와 함께하면 더 빠르게 정상에 도달합니다.',
  '긍정의 에너지가 더 많은 기록을 쌓게 해 줍니다.',
  '새로운 도전에 행운이 함께합니다.'
];

function getFortuneMessage() {
  return FORTUNE_MESSAGES[Math.floor(Math.random() * FORTUNE_MESSAGES.length)];
}

function resetFortuneCookie() {
  const card = document.querySelector('.fortune-card');
  const slip = document.querySelector('.fortune-slip');
  const message = document.getElementById('fortune-message');
  if (!card || !slip || !message) return;
  card.classList.remove('opened');
  slip.textContent = '포춘쿠키를 까서 확인하세요.';
  message.textContent = '포춘쿠키를 까서 결과를 확인해 보세요.';
}

function setFortuneMessage() {
  const card = document.querySelector('.fortune-card');
  const slip = document.querySelector('.fortune-slip');
  const message = document.getElementById('fortune-message');
  const btn = document.getElementById('fortune-refresh-btn');
  if (!card || !slip || !message || !btn) return;

  if (btn.disabled) return;
  const newMessage = getFortuneMessage();
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = '깨는 중...';
  card.classList.remove('opened');
  slip.textContent = '';
  message.textContent = '포춘쿠키를 까는 중...';

  void card.offsetWidth;

  setTimeout(() => {
    card.classList.add('opened');
    slip.textContent = newMessage;
    message.textContent = newMessage;
  }, 180);

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }, 700);
}

function initFortuneCookie() {
  const btn = document.getElementById('fortune-refresh-btn');
  const cookie = document.getElementById('fortune-cookie');
  if (!btn || !cookie) return;
  resetFortuneCookie();
  btn.addEventListener('click', setFortuneMessage);
  cookie.addEventListener('click', setFortuneMessage);
}

function renderPodium(top3) {
  const el = document.getElementById('podium');
  const section = document.getElementById('podium-section');
  if (!top3.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  el.innerHTML = order.map(s => `
    <div class="podium-card rank-${s.rank}">
      <span class="podium-medal">${MEDALS[s.rank - 1] || '🏅'}</span>
      <div class="podium-rank-num">${s.rank}위</div>
      <div class="podium-name">${escHtml(s.name)}</div>
      <div class="podium-progress-wrap">
        <div class="podium-progress-label">${s.totalScore}점</div>
        <div class="podium-progress-sub">종합점수</div>
      </div>
    </div>
  `).join('');
}

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
      <div class="student-name" title="${escHtml(s.name)}"><button type="button" class="student-link" data-name="${escHtml(s.name)}">${escHtml(s.name)}</button></div>
      <div>${riverHTML(s.progress, i)}</div>
      <div class="level-badge">${levelLabel(s.progressScore ?? s.progress)}</div>
      <div class="score-val ${scoreClass(s.progressScore)}">${formatScore(s.progressScore)}점</div>
    </div>
  `).join('');
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
  attachStudentModalHandlers();
}

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

function openStudentModal(name) {
  currentStudentName = name;
  document.getElementById('student-modal-title').textContent = `${name}님의 인증 현황`;
  document.getElementById('student-modal-subtitle').textContent = '생년월일 마지막 4자리로 본인 인증 후 정보를 확인하세요.';
  document.getElementById('student-modal-code').value = '';
  document.getElementById('student-modal-login-message').textContent = '';
  document.getElementById('student-modal-name').value = name;
  document.getElementById('student-modal-login').style.display = '';
  document.getElementById('student-modal-content').style.display = 'none';
  document.getElementById('student-modal-overlay').style.display = 'flex';
}

function closeStudentModal() {
  document.getElementById('student-modal-overlay').style.display = 'none';
}

function attachStudentModalHandlers() {
  document.querySelectorAll('.student-link').forEach(button => {
    button.addEventListener('click', () => {
      const name = button.dataset.name;
      if (name) openStudentModal(name);
    });
  });
}

async function loginStudentModal(event) {
  event.preventDefault();
  const code = document.getElementById('student-modal-code').value.trim();
  const message = document.getElementById('student-modal-login-message');
  if (!currentStudentName) return;
  message.textContent = '로그인 중...';
  try {
    const res = await fetch(`/api/student/${encodeURIComponent(currentStudentName)}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || '로그인에 실패했습니다.');
    message.textContent = '로그인 성공! 정보를 불러옵니다.';
    await loadStudentModalData(currentStudentName);
  } catch (err) {
    message.textContent = err.message;
    message.className = 'field-note error-text';
  }
}

async function loadStudentModalData(name) {
  const res = await fetch(`/api/student/${encodeURIComponent(name)}`);
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || '정보를 불러오지 못했습니다.');
  }
  const data = json.data;
  document.getElementById('student-modal-progress').textContent = `${data.progress.toFixed(1)}%`;
  document.getElementById('student-modal-level').textContent = levelLabel(data.progressScore);
  document.getElementById('student-modal-progress-score').textContent = `${data.progressScore}점`;
  document.getElementById('student-modal-revenue-total').textContent = `${data.revenueTotal.toLocaleString()}원`;
  document.getElementById('student-modal-revenue-score').textContent = `${data.revenueScore}점`;
  document.getElementById('student-modal-approved-missions').textContent = `${data.missionApprovedCount}개`;
  document.getElementById('student-modal-approved-weeks').textContent = `${data.missionWeekCount}주차`;

  const riverContainer = document.getElementById('student-modal-river');
  riverContainer.innerHTML = riverHTML(data.progress, 0);

  const missionList = document.getElementById('student-modal-mission-list');
  missionList.innerHTML = data.missions.length
    ? data.missions.map(m => `
        <div class="mission-card">
          <div>
            <div class="mission-title">${escHtml(m.title)} ${m.week ? `[W${m.week}]` : ''}</div>
            <p class="field-note">${escHtml(m.description || '설명이 없습니다.')}${m.submission_status ? ` / 상태: ${escHtml(m.submission_status)}` : ''}</p>
          </div>
        </div>
      `).join('')
    : '<p class="field-note">등록된 미션이 없습니다.</p>';

  document.getElementById('student-modal-content').style.display = '';
  document.getElementById('student-modal-login').style.display = 'none';
  attachModalRiverAnimation();
}

function attachModalRiverAnimation() {
  requestAnimationFrame(() => {
    document.querySelectorAll('#student-modal-river .duck').forEach(duck => {
      const wrap = duck.closest('.river-wrap');
      const targetPct = parseFloat(wrap.dataset.duckPct);
      duck.style.left = '0px';
      setTimeout(() => {
        duck.style.left = `calc(${targetPct}% - 14px)`;
      }, 100);
    });
    document.querySelectorAll('#student-modal-river .river-fill').forEach(fill => {
      const wrap = fill.closest('.river-wrap');
      const progress = parseFloat(wrap.dataset.progress);
      fill.style.width = '0%';
      setTimeout(() => { fill.style.width = `${progress}%`; }, 100);
    });
  });
}

function initStudentModal() {
  document.getElementById('student-modal-close').addEventListener('click', closeStudentModal);
  document.getElementById('student-modal-overlay').addEventListener('click', event => {
    if (event.target.id === 'student-modal-overlay') closeStudentModal();
  });
  document.getElementById('student-modal-login-form').addEventListener('submit', loginStudentModal);
}

let currentStudentName = null;

loadLeaderboard();
initFortuneCookie();
initStudentModal();
