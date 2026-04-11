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
const DUCKS = ['🦆', '🐥', '🐤', '🐣'];
function duckFor(index) { return DUCKS[index % DUCKS.length]; }

function riverHTML(progress, rowIndex) {
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

function changeBadgeHTML(change) {
  if (change > 0) return `<span class="change-badge change-up">▲ ${change}</span>`;
  if (change < 0) return `<span class="change-badge change-down">▼ ${Math.abs(change)}</span>`;
  return `<span class="change-badge change-same">– 0</span>`;
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
        <div class="podium-progress-label">${s.progress.toFixed(1)}%</div>
        <div class="podium-progress-sub">진도율</div>
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
      <div class="student-name" title="${escHtml(s.name)}">${escHtml(s.name)}</div>
      <div>${riverHTML(s.progress, i)}</div>
      <div class="score-val">${formatScore(s.score)}</div>
      <div>${changeBadgeHTML(s.change)}</div>
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

async function loadRevenueSummary(name) {
  const output = document.getElementById('summary-output');
  if (!name) {
    output.innerHTML = '<p>이름을 입력하고 조회 버튼을 눌러 주세요.</p>';
    return;
  }
  output.innerHTML = '<p class="field-note">조회 중입니다...</p>';
  try {
    const res = await fetch(`/api/earnings/summary?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`상태 코드 ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '요약 정보를 불러오지 못했습니다.');
    const data = json.data;
    output.innerHTML = `
      <div class="summary-grid">
        <div><strong>이름</strong><p>${escHtml(data.studentName)}</p></div>
        <div><strong>승인 수익</strong><p>${Number(data.revenueTotal).toLocaleString()}원</p></div>
        <div><strong>레벨</strong><p>${escHtml(data.revenueLevel)}</p></div>
        <div><strong>인증 포인트</strong><p>${escHtml(String(data.points))}점</p></div>
      </div>
    `;
  } catch (err) {
    output.innerHTML = `<p class="field-note error-text">${escHtml(err.message)}</p>`;
  }
}

async function loadMissions() {
  const list = document.getElementById('mission-list');
  const select = document.querySelector('#mission-form select[name="missionId"]');
  list.innerHTML = '<p class="field-note">미션 목록을 불러오는 중입니다...</p>';
  select.innerHTML = '<option value="">미션을 선택하세요</option>';
  try {
    const res = await fetch('/api/missions');
    if (!res.ok) throw new Error(`상태 코드 ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '미션 목록을 불러오지 못했습니다.');
    const missions = json.data || [];
    if (!missions.length) {
      list.innerHTML = '<p class="field-note">등록된 미션이 없습니다.</p>';
      return;
    }
    select.innerHTML = '<option value="">미션을 선택하세요</option>' + missions.map(m => `
      <option value="${m.id}">[${m.week ? `W${m.week}` : '상시'}] ${escHtml(m.title)}</option>
    `).join('');
    list.innerHTML = missions.map(m => `
      <div class="mission-card">
        <div>
          <div class="mission-title">${escHtml(m.title)}</div>
          <p class="field-note">${escHtml(m.description || '설명이 없습니다.')}</p>
        </div>
        <div class="mission-meta">${m.week ? `Week ${m.week}` : '상시'}</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="field-note error-text">${escHtml(err.message)}</p>`;
  }
}

async function loadSubmissionLists(name) {
  const revenueContainer = document.getElementById('submission-list');
  const missionContainer = document.getElementById('mission-submission-list');
  const query = name ? `?name=${encodeURIComponent(name)}` : '';
  revenueContainer.innerHTML = '<p class="field-note">수익 제출 내역을 불러오는 중입니다...</p>';
  missionContainer.innerHTML = '<p class="field-note">미션 제출 내역을 불러오는 중입니다...</p>';
  try {
    const [revRes, missionRes] = await Promise.all([
      fetch(`/api/earnings/submissions${query}`),
      fetch(`/api/mission-submissions${query}`),
    ]);
    if (!revRes.ok) throw new Error(`수익 제출 조회 오류 ${revRes.status}`);
    if (!missionRes.ok) throw new Error(`미션 제출 조회 오류 ${missionRes.status}`);
    const revJson = await revRes.json();
    const missionJson = await missionRes.json();
    if (!revJson.success) throw new Error(revJson.error || '수익 제출 내역을 불러오지 못했습니다.');
    if (!missionJson.success) throw new Error(missionJson.error || '미션 제출 내역을 불러오지 못했습니다.');
    const recentRevenue = revJson.data || [];
    const recentMissions = missionJson.data || [];
    revenueContainer.innerHTML = recentRevenue.length
      ? recentRevenue.map(item => `
        <div class="submission-card">
          <div>
            <div class="submission-title">${escHtml(item.student_name)} - ${Number(item.amount).toLocaleString()}원</div>
            <div class="field-note">상태: ${escHtml(item.status)}</div>
          </div>
          <div class="submission-meta">${formatTime(item.submitted_at)}</div>
        </div>
      `).join('')
      : '<p class="field-note">수익 제출 내역이 없습니다.</p>';
    missionContainer.innerHTML = recentMissions.length
      ? recentMissions.map(item => `
        <div class="submission-card">
          <div>
            <div class="submission-title">${escHtml(item.student_name)} - ${escHtml(item.mission_title || '미션')}</div>
            <div class="field-note">상태: ${escHtml(item.status)}</div>
            <p class="field-note">${escHtml(item.notes || '설명 없음')}</p>
          </div>
          <div class="submission-meta">${formatTime(item.submitted_at)}</div>
        </div>
      `).join('')
      : '<p class="field-note">미션 제출 내역이 없습니다.</p>';
  } catch (err) {
    const message = `<p class="field-note error-text">${escHtml(err.message)}</p>`;
    revenueContainer.innerHTML = message;
    missionContainer.innerHTML = message;
  }
}

async function submitEarningsForm(event) {
  event.preventDefault();
  const form = document.getElementById('earnings-form');
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = '제출 중...';
  try {
    const res = await fetch('/api/earnings/submit', { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || `서버 오류 ${res.status}`);
    form.reset();
    alert('수익 인증이 제출되었습니다. 관리자 승인을 기다려주세요.');
    const name = document.querySelector('#summary-name-input').value.trim();
    if (name) loadSubmissionLists(name);
  } catch (err) {
    alert(`제출 실패: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '제출하기';
  }
}

async function submitMissionForm(event) {
  event.preventDefault();
  const form = document.getElementById('mission-form');
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = '제출 중...';
  try {
    const res = await fetch('/api/mission-submissions', { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || `서버 오류 ${res.status}`);
    form.reset();
    alert('미션 인증이 제출되었습니다. 관리자 승인을 기다려주세요.');
    const name = document.querySelector('#summary-name-input').value.trim();
    if (name) loadSubmissionLists(name);
  } catch (err) {
    alert(`제출 실패: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '미션 제출';
  }
}

function showTab(tabName) {
  document.querySelectorAll('.tab-button').forEach(button => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

function initTabs() {
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      showTab(button.dataset.tab);
      if (button.dataset.tab === 'revenue') {
        const name = document.querySelector('#summary-name-input').value.trim();
        if (name) {
          loadRevenueSummary(name);
          loadSubmissionLists(name);
        }
      }
    });
  });
  document.getElementById('summary-search-btn').addEventListener('click', () => {
    const name = document.getElementById('summary-name-input').value.trim();
    loadRevenueSummary(name);
    loadSubmissionLists(name);
  });
  document.getElementById('earnings-form').addEventListener('submit', submitEarningsForm);
  document.getElementById('mission-form').addEventListener('submit', submitMissionForm);
}

loadLeaderboard();
loadMissions();
initTabs();
