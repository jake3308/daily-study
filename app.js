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
const quizCard = document.querySelector('#quizCard');
const doneCard = document.querySelector('#doneCard');
const scoreSummary = document.querySelector('#scoreSummary');

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

let session = null;
let progress = null;
let currentQuestions = [];
let answered = false;
let cachedSources = [];

function showAuth(msg='') {
  authView.classList.remove('hidden');
  studyView.classList.add('hidden');
  authMessage.textContent = msg;
}
function showStudy() {
  authView.classList.add('hidden');
  studyView.classList.remove('hidden');
}

function setMainMode(mode) {
  const studyParts = [document.querySelector('.progress-wrap'), quizCard, doneCard];
  if (mode === 'sources') {
    studyParts.forEach(el => el.classList.add('hidden'));
    sourcesView.classList.remove('hidden');
    loadSources();
  } else {
    sourcesView.classList.add('hidden');
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

async function loadProgress() {
  const uid = session.user.id;
  let { data, error } = await sb.from('study_progress').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!data) {
    const inserted = await sb.from('study_progress').insert({ user_id: uid }).select().single();
    if (inserted.error) throw inserted.error;
    data = inserted.data;
  }
  progress = data;
  renderDay();
}

function getQuestionsForDay(day) {
  return window.STUDY_QUESTION_BANK[day] || [];
}

function renderDay() {
  showStudy();
  sourcesView.classList.add('hidden');
  document.querySelector('.progress-wrap').classList.remove('hidden');
  currentQuestions = getQuestionsForDay(progress.current_day);
  dayLabel.textContent = `Day ${progress.current_day}`;

  if (!currentQuestions.length) {
    quizCard.classList.add('hidden');
    doneCard.classList.remove('hidden');
    scoreSummary.textContent = '아직 이 Day의 문제가 등록되지 않았습니다.';
    return;
  }

  if (progress.current_index >= currentQuestions.length) {
    renderDone();
    return;
  }
  doneCard.classList.add('hidden');
  quizCard.classList.remove('hidden');
  renderQuestion();
}

function renderQuestion() {
  answered = false;
  const q = currentQuestions[progress.current_index];
  const total = currentQuestions.length;
  const current = progress.current_index + 1;

  stepLabel.textContent = q.step;
  progressText.textContent = `${current} / ${total}`;
  progressBar.style.width = `${(current / total) * 100}%`;
  questionMeta.textContent = q.meta;
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
    btn.addEventListener('click', () => answer(idx, btn));
    choices.appendChild(btn);
  });
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';
  nextBtn.classList.add('hidden');
}

async function answer(selectedIdx) {
  if (answered) return;
  answered = true;
  const q = currentQuestions[progress.current_index];
  const correct = selectedIdx === q.answer;

  [...choices.children].forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.answer) btn.classList.add('correct');
    if (idx === selectedIdx && !correct) btn.classList.add('wrong');
  });

  feedback.className = `feedback ${correct ? 'ok' : 'bad'}`;
  feedback.innerHTML = `<strong>${correct ? '정답' : '오답'}</strong>${q.explanation}<br><span class="small">${q.vocab || ''}</span>`;
  nextBtn.classList.remove('hidden');

  const uid = session.user.id;
  await sb.from('answer_log').upsert({
    user_id: uid,
    question_id: q.id,
    day_number: progress.current_day,
    step: q.step,
    result: correct ? 'correct' : 'wrong',
    answered_at: new Date().toISOString()
  }, { onConflict: 'user_id,question_id' });

  if (correct) progress.day_score += 1;
  await sb.from('study_progress').update({ day_score: progress.day_score, updated_at: new Date().toISOString() }).eq('user_id', uid);
}

async function nextQuestion() {
  if (!answered) return;
  const uid = session.user.id;
  const nextIndex = progress.current_index + 1;
  progress.current_index = nextIndex;

  await sb.from('study_progress').update({ current_index: nextIndex, updated_at: new Date().toISOString() }).eq('user_id', uid);
  if (nextIndex >= currentQuestions.length) renderDone(); else renderQuestion();
}

function renderDone() {
  quizCard.classList.add('hidden');
  doneCard.classList.remove('hidden');
  scoreSummary.textContent = `${currentQuestions.length}문제 중 ${progress.day_score}문제 정답`;

  if (!document.querySelector('#finishDayBtn')) {
    const btn = document.createElement('button');
    btn.id = 'finishDayBtn';
    btn.className = 'primary';
    btn.textContent = '오늘 완료하고 다음 Day로';
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
  renderDay();
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
  sourceMessage.textContent = '저장했습니다. 이 자료는 계정에 계속 남습니다.';
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
  return v.replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
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
  if (!sb) return showAuth('설정 전 상태입니다. README 순서대로 Supabase 연결을 먼저 해주세요.');
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session) await loadProgress(); else showAuth();
  sb.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    if (session) await loadProgress(); else showAuth();
  });
})();
