const cfg = window.STUDY_CONFIG || {};
const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('YOUR_PROJECT');
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const authView = document.querySelector('#authView');
const studyView = document.querySelector('#studyView');
const authForm = document.querySelector('#authForm');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const signupBtn = document.querySelector('#signupBtn');
const authMessage = document.querySelector('#authMessage');
const logoutBtn = document.querySelector('#logoutBtn');
const dayLabel = document.querySelector('#dayLabel');
const stepLabel = document.querySelector('#stepLabel');
const progressText = document.querySelector('#progressText');
const progressBar = document.querySelector('#progressBar');
const questionMeta = document.querySelector('#questionMeta');
const passage = document.querySelector('#passage');
const questionText = document.querySelector('#questionText');
const choices = document.querySelector('#choices');
const feedback = document.querySelector('#feedback');
const nextBtn = document.querySelector('#nextBtn');
const unsureBtn = document.querySelector('#unsureBtn');
const quizCard = document.querySelector('#quizCard');
const loadingCard = document.querySelector('#loadingCard');
const loadingMessage = document.querySelector('#loadingMessage');
const retryGenerateBtn = document.querySelector('#retryGenerateBtn');
const doneCard = document.querySelector('#doneCard');
const scoreSummary = document.querySelector('#scoreSummary');
const modelBadge = document.querySelector('#modelBadge');

const sourcesBtn = document.querySelector('#sourcesBtn');
const backToStudyBtn = document.querySelector('#backToStudyBtn');
const sourcesView = document.querySelector('#sourcesView');
const sourceTitle = document.querySelector('#sourceTitle');
const sourceTags = document.querySelector('#sourceTags');
const sourceText = document.querySelector('#sourceText');
const sourceFile = document.querySelector('#sourceFile');
const saveSourceBtn = document.querySelector('#saveSourceBtn');
const sourceMessage = document.querySelector('#sourceMessage');
const sourceList = document.querySelector('#sourceList');
const exportSourcesBtn = document.querySelector('#exportSourcesBtn');

const LEGACY_SOURCE_TITLE = '기존 민법 참고자료 (이전 메모)';

let session = null;
let progress = null;
let currentQuestions = [];
let answered = false;
let lastAnswerWasCorrect = false;
let markedUnsure = false;
let cachedSources = [];
let currentGenerationMeta = null;

function showAuth(msg='') {
  authView.classList.remove('hidden');
  studyView.classList.add('hidden');
  authMessage.textContent = msg;
}
function showStudy() {
  authView.classList.add('hidden');
  studyView.classList.remove('hidden');
}

function hideStudyCards() {
  quizCard.classList.add('hidden');
  doneCard.classList.add('hidden');
  loadingCard.classList.add('hidden');
}

function setMainMode(mode) {
  const progressWrap = document.querySelector('.progress-wrap');
  if (mode === 'sources') {
    progressWrap.classList.add('hidden');
    hideStudyCards();
    sourcesView.classList.remove('hidden');
    loadSources();
  } else {
    sourcesView.classList.add('hidden');
    progressWrap.classList.remove('hidden');
    renderDay();
  }
}

async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  session = data.session;
  if (session) await loadProgress();
}

async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  session = data.session;
  if (session) {
    await loadProgress();
  } else {
    showAuth('계정은 만들어졌습니다. 이메일 확인이 켜져 있다면 메일 인증 후 로그인하세요.');
  }
}

async function ensureLegacyCivilLawSource() {
  if (!session?.user?.id) return;
  const uid = session.user.id;

  const existing = await sb.from('study_sources')
    .select('id')
    .eq('user_id', uid)
    .eq('subject', '민법')
    .eq('title', LEGACY_SOURCE_TITLE)
    .limit(1);

  if (existing.error || (existing.data && existing.data.length)) return;

  try {
    const res = await fetch('./민법_기존_참고자료.txt', { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    if (!text.trim()) return;

    await sb.from('study_sources').insert({
      user_id: uid,
      subject: '민법',
      title: LEGACY_SOURCE_TITLE,
      tags: ['기존자료', '오답', '판례', '민법'],
      source_text: text,
      updated_at: new Date().toISOString()
    });
  } catch (_) {
    // 기존 자료 불러오기 실패가 학습 화면을 막지는 않도록 한다.
  }
}

async function loadProgress() {
  const uid = session.user.id;
  let { data, error } = await sb.from('study_progress').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!data) {
    const inserted = await sb.from('study_progress').insert({ user_id: uid, current_day: 1 }).select().single();
    if (inserted.error) throw inserted.error;
    data = inserted.data;
  }
  progress = data;
  if (!progress.current_day || progress.current_day < 1) progress.current_day = 1;
  if (progress.current_index == null) progress.current_index = 0;
  if (progress.day_score == null) progress.day_score = 0;
  await ensureLegacyCivilLawSource();
  await renderDay();
}

async function fetchDailyQuestions(dayNumber) {
  const { data, error } = await sb.from('daily_questions')
    .select('questions,model,prompt_version,generated_at')
    .eq('user_id', session.user.id)
    .eq('day_number', dayNumber)
    .maybeSingle();
  if (error) throw error;
  if (data?.questions?.length) return data;
  return null;
}

const TOTAL_QUESTIONS = 10;
const INDEX_STAGE = [
  'TOEIC Part 6','TOEIC Part 6','TOEIC Part 6','TOEIC Part 6',
  'TOEIC Part 7','TOEIC Part 7',
  '민법','물리','화학','생물'
];

const GROUPS = [
  { step: 'TOEIC Part 6', start: 0, end: 4, label: 'Part 6' },
  { step: 'TOEIC Part 7', start: 4, end: 6, label: 'Part 7' },
  { step: '민법', start: 6, end: 7, label: '민법' },
  { step: '물리', start: 7, end: 8, label: '물리' },
  { step: '화학', start: 8, end: 9, label: '화학' },
  { step: '생물', start: 9, end: 10, label: '생물' },
];

function groupForIndex(index) {
  return GROUPS.find(g => index >= g.start && index < g.end) || GROUPS[GROUPS.length - 1];
}

function groupPosition(index) {
  const g = groupForIndex(index);
  return {
    ...g,
    number: index - g.start + 1,
    total: g.end - g.start,
    isLast: index === g.end - 1,
  };
}

function nextSectionLabel(index) {
  if (index === 3) return 'Part 7 지문으로';
  if (index === 5) return '민법으로';
  if (index === 6) return '물리로';
  if (index === 7) return '화학으로';
  if (index === 8) return '생물로';
  if (index === 9) return '오늘 완료';
  return '다음 문제';
}

function pendingStageName() {
  return INDEX_STAGE[Math.min(progress?.current_index || 0, INDEX_STAGE.length - 1)] || '다음 문제';
}

async function generateNextBlock(dayNumber) {
  loadingCard.classList.remove('hidden');
  quizCard.classList.add('hidden');
  doneCard.classList.add('hidden');
  retryGenerateBtn.classList.add('hidden');

  const stage = pendingStageName();
  if (stage === 'TOEIC Part 6') {
    loadingMessage.textContent = 'Part 6 지문 1개와 연결된 4문제를 준비 중입니다…';
  } else if (stage === 'TOEIC Part 7') {
    loadingMessage.textContent = 'Part 7 지문 1개와 연결된 2문제를 준비 중입니다…';
  } else {
    loadingMessage.textContent = `${stage} 문제를 준비 중입니다…`;
  }

  const token = session?.access_token;
  if (!token) throw new Error('로그인 세션이 없습니다. 다시 로그인해주세요.');

  const r = await fetch('/api/generate-day', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ dayNumber }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const version = data.prompt_version ? ` [${data.prompt_version}]` : '';
    throw new Error(`${data.error || `문제 생성 실패 (${r.status})`}${version}`);
  }
  return data;
}

async function loadOrGenerateForCurrentIndex(dayNumber) {
  const cached = await fetchDailyQuestions(dayNumber);
  if (cached?.questions?.length > progress.current_index) return cached;

  // 현재 위치에 필요한 묶음만 생성한다.
  // Part 6(4문제) -> Part 7(2문제) -> 민법 -> 물리 -> 화학 -> 생물 순서.
  return generateNextBlock(dayNumber);
}

let prefetchInFlight = false;
let lastPrefetchQuestionCount = -1;

async function prefetchNextBlock() {
  if (prefetchInFlight || !session?.access_token || !progress) return;
  if (!Array.isArray(currentQuestions) || currentQuestions.length >= TOTAL_QUESTIONS) return;

  // 같은 저장 상태에서 중복 호출 방지.
  if (lastPrefetchQuestionCount === currentQuestions.length) return;
  lastPrefetchQuestionCount = currentQuestions.length;
  prefetchInFlight = true;

  try {
    const r = await fetch('/api/generate-day', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ dayNumber: progress.current_day }),
    });

    if (!r.ok) return;
    const data = await r.json().catch(() => ({}));
    if (Array.isArray(data.questions) && data.questions.length > currentQuestions.length) {
      currentQuestions = data.questions;
      currentGenerationMeta = data;
    }
  } catch (_) {
    // 선행 생성 실패는 학습 화면을 막지 않는다.
  } finally {
    prefetchInFlight = false;
  }
}

async function renderDay() {
  showStudy();
  sourcesView.classList.add('hidden');
  document.querySelector('.progress-wrap').classList.remove('hidden');
  dayLabel.textContent = `Day ${progress.current_day}`;
  stepLabel.textContent = progress.current_index >= TOTAL_QUESTIONS ? '완료' : pendingStageName();
  if (progress.current_index < TOTAL_QUESTIONS) {
    const gp = groupPosition(progress.current_index);
    progressText.textContent = `${gp.number} / ${gp.total}`;
    progressBar.style.width = `${(gp.number / gp.total) * 100}%`;
  } else {
    progressText.textContent = `${TOTAL_QUESTIONS} / ${TOTAL_QUESTIONS}`;
    progressBar.style.width = '100%';
  }
  modelBadge.textContent = 'Sol';

  if (progress.current_index >= TOTAL_QUESTIONS) {
    currentQuestions = (await fetchDailyQuestions(progress.current_day))?.questions || [];
    renderDone();
    return;
  }

  try {
    hideStudyCards();
    loadingCard.classList.remove('hidden');
    loadingMessage.textContent = '저장된 문제를 확인하는 중…';
    retryGenerateBtn.classList.add('hidden');

    const payload = await loadOrGenerateForCurrentIndex(progress.current_day);
    currentQuestions = payload.questions || [];
    currentGenerationMeta = payload;
    loadingCard.classList.add('hidden');

    if (currentQuestions.length <= progress.current_index) {
      throw new Error('현재 순서의 문제가 아직 생성되지 않았습니다.');
    }

    doneCard.classList.add('hidden');
    quizCard.classList.remove('hidden');
    renderQuestion();

    // 사용자가 현재 묶음을 푸는 동안 다음 묶음을 미리 만든다.
    setTimeout(() => prefetchNextBlock(), 800);
  } catch (err) {
    hideStudyCards();
    loadingCard.classList.remove('hidden');
    loadingMessage.textContent = `문제 준비 실패: ${err.message}`;
    retryGenerateBtn.classList.remove('hidden');
  }
}

function renderQuestion() {
  answered = false;
  lastAnswerWasCorrect = false;
  markedUnsure = false;
  const q = currentQuestions[progress.current_index];
  const total = TOTAL_QUESTIONS;
  const current = progress.current_index + 1;
  const gp = groupPosition(progress.current_index);

  stepLabel.textContent = q.step;
  progressText.textContent = `${gp.number} / ${gp.total}`;
  progressBar.style.width = `${(gp.number / gp.total) * 100}%`;

  const metaBits = [
    `오늘 ${current}/${total}`,
    `${gp.label} ${gp.number}/${gp.total}`,
    q.difficulty || '',
    q.meta || ''
  ].filter(Boolean);
  questionMeta.textContent = metaBits.join(' · ');
  questionText.textContent = q.question;

  if (q.passage) {
    passage.textContent = q.passage;
    passage.classList.remove('hidden');
  } else passage.classList.add('hidden');

  choices.innerHTML = '';
  q.choices.forEach((label, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = `${String.fromCharCode(65 + idx)}. ${label}`;
    btn.addEventListener('click', () => answer(idx));
    choices.appendChild(btn);
  });
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';
  nextBtn.classList.add('hidden');
  nextBtn.textContent = nextSectionLabel(progress.current_index);
  unsureBtn.classList.add('hidden');
  unsureBtn.disabled = false;
  unsureBtn.textContent = '맞혔지만 헷갈림';
}

async function upsertReview(q, result) {
  const uid = session.user.id;
  const conceptKey = q.concept || `${q.step}:${q.meta || q.id}`;
  const { data: existing } = await sb.from('review_items')
    .select('*')
    .eq('user_id', uid)
    .eq('concept_key', conceptKey)
    .maybeSingle();

  let repetitions = existing?.repetitions || 0;
  let ease = Number(existing?.ease || 2.5);
  let intervalDays = Number(existing?.interval_days || 1);

  if (result === 'correct') {
    repetitions += 1;
    const schedule = [1, 3, 7, 14, 30, 60, 90];
    intervalDays = schedule[Math.min(repetitions - 1, schedule.length - 1)];
    ease = Math.min(3.0, ease + 0.05);
  } else if (result === 'unsure') {
    repetitions = Math.max(0, repetitions - 1);
    intervalDays = 1;
    ease = Math.max(1.3, ease - 0.1);
  } else {
    repetitions = 0;
    intervalDays = 1;
    ease = Math.max(1.3, ease - 0.2);
  }

  const now = new Date();
  const next = new Date(now.getTime() + intervalDays * 86400000);
  await sb.from('review_items').upsert({
    user_id: uid,
    concept_key: conceptKey,
    ease,
    interval_days: intervalDays,
    repetitions,
    last_reviewed_at: now.toISOString(),
    next_review_at: next.toISOString(),
  }, { onConflict: 'user_id,concept_key' });
}

async function saveAnswerResult(q, result) {
  const uid = session.user.id;
  await sb.from('answer_log').upsert({
    user_id: uid,
    question_id: q.id,
    day_number: progress.current_day,
    step: q.step,
    subject: q.step,
    concept_key: q.concept || null,
    result,
    answered_at: new Date().toISOString()
  }, { onConflict: 'user_id,question_id' });
  await upsertReview(q, result);
}

async function answer(selectedIdx) {
  if (answered) return;
  answered = true;
  const q = currentQuestions[progress.current_index];
  const correct = selectedIdx === q.answer;
  lastAnswerWasCorrect = correct;

  [...choices.children].forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.answer) btn.classList.add('correct');
    if (idx === selectedIdx && !correct) btn.classList.add('wrong');
  });

  feedback.className = `feedback ${correct ? 'ok' : 'bad'}`;
  feedback.innerHTML = `<strong>${correct ? '정답' : '오답'}</strong>${escapeHtml(q.explanation).replace(/\n/g, '<br>')}${q.vocab ? `<br><span class="small">${escapeHtml(q.vocab)}</span>` : ''}`;
  nextBtn.classList.remove('hidden');
  unsureBtn.classList.remove('hidden');

  await saveAnswerResult(q, correct ? 'correct' : 'wrong');

  if (correct) progress.day_score += 1;
  await sb.from('study_progress').update({ day_score: progress.day_score, updated_at: new Date().toISOString() }).eq('user_id', session.user.id);
}

async function markUnsure() {
  if (!answered || markedUnsure) return;
  markedUnsure = true;
  const q = currentQuestions[progress.current_index];
  await saveAnswerResult(q, 'unsure');
  unsureBtn.disabled = true;
  unsureBtn.textContent = '헷갈림으로 저장됨';
}

async function nextQuestion() {
  if (!answered) return;
  const uid = session.user.id;
  const nextIndex = progress.current_index + 1;
  progress.current_index = nextIndex;

  await sb.from('study_progress').update({
    current_index: nextIndex,
    updated_at: new Date().toISOString()
  }).eq('user_id', uid);

  if (nextIndex >= TOTAL_QUESTIONS) {
    renderDone();
    return;
  }

  if (nextIndex < currentQuestions.length) {
    renderQuestion();
    setTimeout(() => prefetchNextBlock(), 800);
  } else {
    await renderDay();
  }
}

function renderDone() {
  loadingCard.classList.add('hidden');
  quizCard.classList.add('hidden');
  doneCard.classList.remove('hidden');
  stepLabel.textContent = '완료';
  progressText.textContent = `${TOTAL_QUESTIONS} / ${TOTAL_QUESTIONS}`;
  progressBar.style.width = '100%';
  scoreSummary.textContent = `${TOTAL_QUESTIONS}문제 중 ${progress.day_score}문제 정답`;

  if (!document.querySelector('#finishDayBtn')) {
    const btn = document.createElement('button');
    btn.id = 'finishDayBtn';
    btn.className = 'primary';
    btn.textContent = '오늘 완료하고 다음 Day 준비';
    btn.addEventListener('click', finishDay);
    doneCard.appendChild(btn);
  }
}

async function finishDay() {
  const uid = session.user.id;
  const nextDay = progress.current_day + 1;
  const { error } = await sb.from('study_progress').update({
    current_day: nextDay,
    current_index: 0,
    day_score: 0,
    updated_at: new Date().toISOString()
  }).eq('user_id', uid);
  if (error) throw error;
  progress.current_day = nextDay;
  progress.current_index = 0;
  progress.day_score = 0;
  const btn = document.querySelector('#finishDayBtn');
  if (btn) btn.remove();
  await renderDay();
}

function parseTags(raw) {
  return raw.split(',').map(v => v.trim()).filter(Boolean).slice(0, 30);
}

async function saveSource() {
  const title = sourceTitle.value.trim();
  const text = sourceText.value.trim();
  if (!title || !text) {
    sourceMessage.textContent = '제목과 내용을 모두 입력해주세요.';
    return;
  }
  saveSourceBtn.disabled = true;
  sourceMessage.textContent = '저장 중...';
  const { error } = await sb.from('study_sources').insert({
    user_id: session.user.id,
    subject: '민법',
    title,
    tags: parseTags(sourceTags.value),
    source_text: text,
    updated_at: new Date().toISOString()
  });
  saveSourceBtn.disabled = false;
  if (error) {
    sourceMessage.textContent = error.message;
    return;
  }
  sourceTitle.value = '';
  sourceTags.value = '';
  sourceText.value = '';
  sourceFile.value = '';
  sourceMessage.textContent = '저장했습니다. 다음 새 Day 생성부터 출제 참고자료에 반영됩니다.';
  await loadSources();
}

async function loadSources() {
  sourceList.innerHTML = '<p class="muted">불러오는 중...</p>';
  const { data, error } = await sb.from('study_sources')
    .select('id,title,tags,source_text,created_at,updated_at')
    .eq('user_id', session.user.id)
    .eq('subject', '민법')
    .order('updated_at', { ascending: false });

  if (error) {
    sourceList.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    return;
  }
  cachedSources = data || [];
  renderSources();
}

function escapeHtml(v='') {
  return String(v).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function renderSources() {
  if (!cachedSources.length) {
    sourceList.innerHTML = '<p class="muted">아직 저장된 자료가 없습니다.</p>';
    return;
  }
  sourceList.innerHTML = cachedSources.map(item => {
    const tags = (item.tags || []).join(', ');
    const preview = item.source_text.length > 1200 ? item.source_text.slice(0, 1200) + '\n…' : item.source_text;
    const date = new Date(item.updated_at).toLocaleString('ko-KR');
    return `<article class="source-item" data-id="${item.id}">
      <h4>${escapeHtml(item.title)}</h4>
      <div class="source-meta">${escapeHtml(tags || '태그 없음')} · ${escapeHtml(date)}</div>
      <div class="source-preview">${escapeHtml(preview)}</div>
      <div class="source-item-actions">
        <button class="ghost edit-source" data-id="${item.id}">수정</button>
        <button class="ghost danger delete-source" data-id="${item.id}">삭제</button>
      </div>
    </article>`;
  }).join('');

  document.querySelectorAll('.delete-source').forEach(btn => btn.addEventListener('click', () => deleteSource(Number(btn.dataset.id))));
  document.querySelectorAll('.edit-source').forEach(btn => btn.addEventListener('click', () => editSource(Number(btn.dataset.id))));
}

function editSource(id) {
  const item = cachedSources.find(v => v.id === id);
  if (!item) return;
  sourceTitle.value = item.title;
  sourceTags.value = (item.tags || []).join(', ');
  sourceText.value = item.source_text;
  sourceMessage.textContent = '내용을 수정한 뒤 “자료 저장”을 누르면 새 버전으로 추가됩니다. 기존 자료는 그대로 남습니다.';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSource(id) {
  if (!confirm('이 자료를 삭제할까요?')) return;
  const { error } = await sb.from('study_sources').delete().eq('id', id).eq('user_id', session.user.id);
  if (error) return alert(error.message);
  await loadSources();
}

function exportSources() {
  if (!cachedSources.length) return;
  const body = cachedSources.map((item, idx) => {
    const tags = (item.tags || []).join(', ');
    return `# ${idx + 1}. ${item.title}\n태그: ${tags}\n\n${item.source_text}\n`;
  }).join('\n----------------------------------------\n\n');
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `민법_참고자료_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

sourceFile.addEventListener('change', async () => {
  const file = sourceFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  sourceText.value = text;
  if (!sourceTitle.value.trim()) sourceTitle.value = file.name.replace(/\.(txt|md)$/i, '');
  sourceMessage.textContent = '파일 내용을 불러왔습니다. 확인 후 저장하세요.';
});

sourcesBtn.addEventListener('click', () => setMainMode('sources'));
backToStudyBtn.addEventListener('click', () => setMainMode('study'));
saveSourceBtn.addEventListener('click', saveSource);
exportSourcesBtn.addEventListener('click', exportSources);
nextBtn.addEventListener('click', nextQuestion);
unsureBtn.addEventListener('click', markUnsure);
retryGenerateBtn.addEventListener('click', renderDay);
logoutBtn.addEventListener('click', async () => { await sb.auth.signOut(); showAuth(); });

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return showAuth('먼저 config.js에 Supabase 정보를 입력하세요.');
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  try { await signIn(email, password); }
  catch (err) { showAuth('로그인 실패: ' + err.message); }
});

signupBtn.addEventListener('click', async () => {
  if (!sb) return showAuth('먼저 config.js에 Supabase 정보를 입력하세요.');
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || password.length < 8) return showAuth('이메일과 8자 이상의 비밀번호를 입력하세요.');
  try { await signUp(email, password); }
  catch (err) { showAuth('가입 실패: ' + err.message); }
});

(async function init() {
  if (!sb) return showAuth('설정 전 상태입니다. config.js의 Supabase 연결 정보를 확인해주세요.');
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session) await loadProgress(); else showAuth();
  sb.auth.onAuthStateChange(async (_event, newSession) => {
    const changed = newSession?.access_token !== session?.access_token;
    session = newSession;
    if (session && changed) await loadProgress();
    if (!session) showAuth();
  });
})();
