function getStudentNameFromPath() {
  const match = window.location.pathname.match(/^\/student\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function levelLabel(level) {
  return {
    egg: '알 🥚',
    baby: '아기 오리 🐣',
    duck: '오리 🦆',
    golden: '황금오리 ✨',
  }[level] || '알 🥚';
}

function updateProgressBar(progress) {
  const bar = document.getElementById('student-progress-bar');
  if (!bar) return;
  const fill = bar.querySelector('.progress-fill');
  if (fill) {
    fill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
}

function showStudentContent() {
  const loginPanel = document.getElementById('student-login');
  const contentPanel = document.getElementById('student-content');
  if (loginPanel) loginPanel.style.display = 'none';
  if (contentPanel) contentPanel.style.display = '';
}

function showStudentLogin(message) {
  const loginPanel = document.getElementById('student-login');
  const contentPanel = document.getElementById('student-content');
  const loginMessage = document.getElementById('student-login-message');
  if (loginPanel) loginPanel.style.display = '';
  if (contentPanel) contentPanel.style.display = 'none';
  if (loginMessage) loginMessage.textContent = message || '';
}

async function loadStudentData(name) {
  const title = document.getElementById('student-name');
  const hiddenName = document.getElementById('studentNameInput');
  const hiddenName2 = document.getElementById('studentNameInput2');
  title.textContent = `${name}님 페이지`;
  hiddenName.value = name;
  hiddenName2.value = name;

  try {
    const res = await fetch(`/api/student/${encodeURIComponent(name)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      if (res.status === 401) {
        showStudentLogin(json.error || '로그인이 필요합니다.');
        return;
      }
      throw new Error(json.error || `서버 오류 ${res.status}`);
    }
    const data = json.data;
    document.getElementById('student-progress').textContent = `${data.progress.toFixed(1)}%`;
    document.getElementById('student-level').textContent = levelLabel(data.progressLevel);
    document.getElementById('student-progress-score').textContent = `${data.progressScore}점`;
    document.getElementById('student-mission-week').textContent = `${data.missionWeekCount}주차`;
    updateProgressBar(data.progress);

    const dbStatus = document.getElementById('student-db-status');
    if (dbStatus) {
      dbStatus.textContent = data.dbConfigured
        ? ''
        : '데이터베이스가 구성되지 않아 제출 및 인증 조회 기능이 제한됩니다.';
    }
    document.getElementById('student-mission-form').style.display = data.dbConfigured ? '' : 'none';
    document.getElementById('student-revenue-form').style.display = data.dbConfigured ? '' : 'none';

    document.getElementById('student-approved-missions').textContent = `${data.missionApprovedCount}개`;
    document.getElementById('student-approved-weeks').textContent = `${data.missionWeekCount}주차`;
    document.getElementById('student-revenue-total').textContent = `${data.revenueTotal.toLocaleString()}원`;
    document.getElementById('student-revenue-level').textContent = levelLabel(data.revenueLevel);

    const missionList = document.getElementById('student-mission-list');
    if (!data.missions.length) {
      missionList.innerHTML = '<p class="field-note">등록된 미션이 없습니다.</p>';
    } else {
      missionList.innerHTML = data.missions.map(m => {
        const status = m.submission_status ? ` / 제출 상태: ${escHtml(m.submission_status)}` : '';
        const when = m.submitted_at ? ` / 제출일: ${formatTime(m.submitted_at)}` : '';
        return `
          <div class="mission-card">
            <div>
              <div class="mission-title">${escHtml(m.title)} ${m.week ? `[W${m.week}]` : ''}</div>
              <p class="field-note">${escHtml(m.description || '설명이 없습니다.')}${status}${when}</p>
            </div>
          </div>
        `;
      }).join('');
    }

    const missionSelect = document.querySelector('#student-mission-form select[name="missionId"]');
    missionSelect.innerHTML = '<option value="">미션을 선택하세요</option>' + data.missions.map(m => `
      <option value="${m.id}">[${m.week ? `W${m.week}` : '상시'}] ${escHtml(m.title)}</option>
    `).join('');

    const missionSubmissions = document.getElementById('student-mission-submissions');
    missionSubmissions.innerHTML = data.missions.filter(m => m.submission_id).length
      ? data.missions.filter(m => m.submission_id).map(m => `
        <div class="submission-card">
          <div>
            <div class="submission-title">${escHtml(m.title)} ${m.week ? `[W${m.week}]` : ''}</div>
            <div class="field-note">상태: ${escHtml(m.submission_status)} / 제출일: ${formatTime(m.submitted_at)}</div>
            <p class="field-note">${escHtml(m.notes || '-')}</p>
          </div>
        </div>
      `).join('')
      : '<p class="field-note">제출된 미션이 없습니다.</p>';

    const revenueSubmissions = document.getElementById('student-revenue-submissions');
    revenueSubmissions.innerHTML = data.revenueSubmissions.length
      ? data.revenueSubmissions.map(item => `
        <div class="submission-card">
          <div>
            <div class="submission-title">${escHtml(item.student_name)} - ${Number(item.amount).toLocaleString()}원</div>
            <div class="field-note">상태: ${escHtml(item.status)}</div>
          </div>
          <div class="submission-meta">${formatTime(item.submitted_at)}</div>
        </div>
      `).join('')
      : '<p class="field-note">제출된 수익 인증이 없습니다.</p>';
    showStudentContent();
  } catch (err) {
    if (err.message.includes('로그인이 필요합니다')) {
      showStudentLogin(err.message);
      return;
    }
    document.querySelector('.main').innerHTML = `<div class="error-box"><p>${escHtml(err.message)}</p></div>`;
  }
}

async function handleStudentLogin(event) {
  event.preventDefault();
  const form = event.target;
  const code = String(form.code.value || '').trim();
  const messageEl = document.getElementById('student-login-message');
  messageEl.textContent = '로그인 중...';
  try {
    const res = await fetch(`/api/student/${encodeURIComponent(getStudentNameFromPath())}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || '로그인에 실패했습니다.');
    messageEl.textContent = '로그인 성공! 정보를 불러옵니다.';
    loadStudentData(getStudentNameFromPath());
  } catch (err) {
    messageEl.textContent = err.message;
    messageEl.className = 'field-note error-text';
  }
}

async function handleMissionSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = '제출 중...';
  try {
    const res = await fetch('/api/mission-submissions', { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || '미션 제출에 실패했습니다.');
    alert('미션 제출이 완료되었습니다. 관리자 승인을 기다려주세요.');
    form.reset();
    loadStudentData(getStudentNameFromPath());
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '미션 제출';
  }
}

async function handleRevenueSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = '제출 중...';
  try {
    const res = await fetch('/api/earnings/submit', { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || '수익 인증 제출에 실패했습니다.');
    alert('수익 인증 제출이 완료되었습니다. 관리자 승인을 기다려주세요.');
    form.reset();
    loadStudentData(getStudentNameFromPath());
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '제출하기';
  }
}

const loginForm = document.getElementById('student-login-form');
if (loginForm) {
  loginForm.addEventListener('submit', handleStudentLogin);
}

document.getElementById('student-mission-form').addEventListener('submit', handleMissionSubmit);
document.getElementById('student-revenue-form').addEventListener('submit', handleRevenueSubmit);

const studentName = getStudentNameFromPath();
if (studentName) {
  loadStudentData(studentName);
} else {
  document.querySelector('.main').innerHTML = '<div class="error-box"><p>올바른 학생 페이지 경로가 아닙니다.</p></div>';
}
