const OPENAI_MODEL = 'gpt-5.6-sol';
const PROMPT_VERSION = 'v8.2-sol-split-fast-stable';
const MAX_SOURCE_CHARS = 14000;
const ACTIVE_TRACK = process.env.STUDY_TRACK === 'patent_focus' ? 'patent_focus' : 'current';

const TRACKS = {
  current: {
    expected: {
      'TOEIC Part 6': 4,
      'TOEIC Part 7': 2,
      '민법': 1,
      '물리': 1,
      '화학': 1,
      '생물': 1,
    },
  },
  // 나중에 영어를 빼고 변리사 법과목을 넣을 때는 Vercel 환경변수 STUDY_TRACK=patent_focus 로 전환.
  // 프론트엔드는 questions 배열을 순서대로 렌더링하므로 같은 UI를 그대로 쓸 수 있다.
  patent_focus: {
    expected: {
      '민법': 1,
      '특허법': 1,
      '상표법': 1,
      '디자인보호법': 1,
      '물리': 1,
      '화학': 1,
      '생물': 1,
    },
  },
};
const EXPECTED = TRACKS[ACTIVE_TRACK].expected;

const CIVIL_KEYWORDS = [
  '민법','조','판례','유치권','질권','저당','근저당','가등기','담보','대리','표현대리','무권대리',
  '채권','채무','양도','인수','상계','취소','해제','해지','시효','제척','점유','소유','등기','공유','합유',
  '조합','임대차','전세','보증','불법행위','손해배상','부당이득','사해행위','채권자취소','채권자대위',
  '선의','악의','과실','착오','허위표시','비진의','조건','기한','법인','법률행위','물권','계약','경매'
];

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function authHeaders(token, anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sbFetch(baseUrl, path, token, anonKey, options = {}) {
  const r = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...authHeaders(token, anonKey),
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!r.ok) {
    const msg = typeof data === 'object' && data?.message ? data.message : `Supabase ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

function extractCivilExcerpt(text, maxChars = 42000) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  const keep = new Set();
  lines.forEach((line, i) => {
    if (CIVIL_KEYWORDS.some(k => line.includes(k))) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 4); j++) keep.add(j);
    }
  });
  const selected = [...keep].sort((a, b) => a - b).map(i => lines[i]).join('\n').trim();
  return (selected || text).slice(0, maxChars);
}

function tokenizeTargets(review, recent) {
  const terms = new Set();
  const add = (value) => {
    String(value || '')
      .split(/[\s:/,_()\[\]·→<>-]+/)
      .map(x => x.trim())
      .filter(x => x.length >= 2 && x.length <= 18)
      .forEach(x => terms.add(x));
  };
  for (const x of review || []) add(x.concept_key);
  for (const x of recent || []) {
    if (x.result === 'wrong' || x.result === 'unsure') add(x.concept_key || x.step || x.subject);
  }
  return [...terms].slice(0, 40);
}

function sourceDigest(sources, review, recent) {
  const targets = tokenizeTargets(review, recent);
  const candidates = [];

  for (const s of sources || []) {
    const title = s.title || '참고자료';
    const tags = (s.tags || []).join(' ');
    const text = String(s.source_text || '');
    if (!text.trim()) continue;

    // 줄 단위 메모를 6줄 묶음으로 쪼개어 현재 약점과 관련된 부분만 고른다.
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 6) {
      const chunk = lines.slice(i, i + 6).join('\n').trim();
      if (!chunk) continue;
      const hay = `${title} ${tags} ${chunk}`;
      let score = 0;
      for (const t of targets) if (hay.includes(t)) score += 8;
      for (const k of CIVIL_KEYWORDS) if (hay.includes(k)) score += 1;
      // 최신 자료와 제목/태그가 있는 자료가 완전히 탈락하지 않게 작은 기본점수.
      score += title ? 1 : 0;
      candidates.push({ score, title, tags, chunk, order: i });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  let out = '';
  const seen = new Set();
  for (const c of candidates) {
    const key = `${c.title}\n${c.chunk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const block = `\n### ${c.title}\n태그: ${c.tags}\n${c.chunk}\n`;
    if ((out + block).length > MAX_SOURCE_CHARS) continue;
    out += block;
    if (out.length >= MAX_SOURCE_CHARS * 0.92) break;
  }
  return out.slice(0, MAX_SOURCE_CHARS);
}

function summarizeReview(items) {
  if (!items?.length) return '아직 누적 복습 기록 없음.';
  return items.slice(0, 16).map((x, i) =>
    `${i + 1}. ${x.concept_key} / 반복 ${x.repetitions ?? 0} / 간격 ${x.interval_days ?? 1}일 / 다음복습 ${x.next_review_at || '미정'}`
  ).join('\n');
}

function summarizeAnswers(items) {
  if (!items?.length) return '아직 최근 정오답 기록 없음.';
  return items.slice(0, 36).map((x, i) =>
    `${i + 1}. Day ${x.day_number} ${x.step}: ${x.result}${x.concept_key ? ` / ${x.concept_key}` : ''}`
  ).join('\n');
}


const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

function englishWordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function totalTextLength(q) {
  return String(q.question || '').length + (q.choices || []).reduce((n, x) => n + String(x || '').length, 0);
}

function outputText(resp) {
  if (typeof resp?.output_text === 'string' && resp.output_text.trim()) return resp.output_text.trim();
  const parts = [];
  for (const item of resp?.output || []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

function questionFields(choiceCount) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      meta: { type: 'string' },
      question: { type: 'string' },
      choices: {
        type: 'array',
        minItems: choiceCount,
        maxItems: choiceCount,
        items: { type: 'string' },
      },
      answer_letter: {
        type: 'string',
        enum: choiceCount === 4 ? ['A','B','C','D'] : ['A','B','C','D','E'],
      },
      explanation: { type: 'string' },
      vocab: { type: 'string' },
      concept: { type: 'string' },
      difficulty: { type: 'string' },
    },
    required: ['meta','question','choices','answer_letter','explanation','vocab','concept','difficulty'],
  };
}

function toeicSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      part6: {
        type: 'object',
        additionalProperties: false,
        properties: {
          passage: { type: 'string' },
          questions: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: questionFields(4),
          },
        },
        required: ['passage','questions'],
      },
      part7: {
        type: 'object',
        additionalProperties: false,
        properties: {
          passage: { type: 'string' },
          questions: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: questionFields(4),
          },
        },
        required: ['passage','questions'],
      },
    },
    required: ['part6','part7'],
  };
}

function examSchema(expectedSteps) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        minItems: expectedSteps.length,
        maxItems: expectedSteps.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string', enum: expectedSteps },
            meta: { type: 'string' },
            passage: { type: 'string' },
            question: { type: 'string' },
            choices: {
              type: 'array',
              minItems: 5,
              maxItems: 5,
              items: { type: 'string' },
            },
            answer_letter: { type: 'string', enum: ['A','B','C','D','E'] },
            explanation: { type: 'string' },
            vocab: { type: 'string' },
            concept: { type: 'string' },
            difficulty: { type: 'string' },
          },
          required: ['step','meta','passage','question','choices','answer_letter','explanation','vocab','concept','difficulty'],
        },
      },
    },
    required: ['questions'],
  };
}

function normalizeLetterQuestion(q, step, passage = '') {
  const letter = String(q.answer_letter || '').toUpperCase();
  const answer = LETTER_TO_INDEX[letter];
  return {
    step,
    meta: String(q.meta || '').trim(),
    passage: String(passage || q.passage || '').trim(),
    question: String(q.question || '').trim(),
    choices: Array.isArray(q.choices) ? q.choices.map(x => String(x)) : [],
    answer,
    explanation: String(q.explanation || '').trim(),
    vocab: String(q.vocab || '').trim(),
    concept: String(q.concept || step).trim(),
    difficulty: String(q.difficulty || '').trim(),
  };
}

function flattenToeic(data) {
  const p6 = String(data?.part6?.passage || '').trim();
  const p7 = String(data?.part7?.passage || '').trim();
  const qs6 = Array.isArray(data?.part6?.questions) ? data.part6.questions : [];
  const qs7 = Array.isArray(data?.part7?.questions) ? data.part7.questions : [];
  return [
    ...qs6.map(q => normalizeLetterQuestion(q, 'TOEIC Part 6', p6)),
    ...qs7.map(q => normalizeLetterQuestion(q, 'TOEIC Part 7', p7)),
  ];
}

function flattenExam(data) {
  return (data?.questions || []).map(q => normalizeLetterQuestion(q, q.step, q.passage));
}

function validateAndNormalize(questions, dayNumber) {
  const expectedTotal = Object.values(EXPECTED).reduce((a,b) => a + b, 0);
  if (!Array.isArray(questions) || questions.length !== expectedTotal) {
    throw new Error(`생성된 문항 수가 ${expectedTotal}개가 아닙니다.`);
  }

  const counts = {};
  questions.forEach((q, idx) => {
    counts[q.step] = (counts[q.step] || 0) + 1;
    const expectedChoices = (q.step === 'TOEIC Part 6' || q.step === 'TOEIC Part 7') ? 4 : 5;
    if (!Array.isArray(q.choices) || q.choices.length !== expectedChoices) {
      throw new Error(`${q.step} 선택지 수가 ${expectedChoices}개가 아닙니다.`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      throw new Error(`${q.step} 정답 형식이 잘못되었습니다.`);
    }
    q.id = `d${dayNumber}-q${String(idx + 1).padStart(2, '0')}`;
  });

  for (const [step, n] of Object.entries(EXPECTED)) {
    if ((counts[step] || 0) !== n) throw new Error(`${step} 문항 구성이 잘못되었습니다.`);
  }

  const part6 = questions.filter(q => q.step === 'TOEIC Part 6');
  const part7 = questions.filter(q => q.step === 'TOEIC Part 7');

  if (part6.length) {
    if (new Set(part6.map(q => q.passage)).size !== 1) throw new Error('Part 6는 하나의 지문을 공유해야 합니다.');
    const words = englishWordCount(part6[0]?.passage);
    if (words < 135 || words > 275) throw new Error(`Part 6 지문 길이가 실전 범위를 벗어났습니다 (${words} words).`);
  }

  if (part7.length) {
    if (new Set(part7.map(q => q.passage)).size !== 1) throw new Error('Part 7은 하나의 지문을 공유해야 합니다.');
    const words = englishWordCount(part7[0]?.passage);
    if (words < 180 || words > 360) throw new Error(`Part 7 지문 길이가 실전 범위를 벗어났습니다 (${words} words).`);
  }

  const civil = questions.find(q => q.step === '민법');
  if (civil && (totalTextLength(civil) < 420 || civil.choices.filter(x => String(x).length >= 40).length < 4)) {
    throw new Error('민법 문항의 선지 밀도/사고량이 변리사 기출 수준에 미달합니다.');
  }

  for (const step of ['특허법','상표법','디자인보호법']) {
    const q = questions.find(x => x.step === step);
    if (q && (totalTextLength(q) < 380 || q.choices.filter(x => String(x).length >= 34).length < 3)) {
      throw new Error(`${step} 문항의 선지 밀도/사고량이 변리사 기출 수준에 미달합니다.`);
    }
  }

  for (const step of ['물리','화학','생물']) {
    const q = questions.find(x => x.step === step);
    if (q && totalTextLength(q) < 240) throw new Error(`${step} 문항이 지나치게 단순합니다.`);
  }

  return questions;
}

function onlyRecent(items, steps) {
  const set = new Set(steps);
  return (items || []).filter(x => set.has(x.step) || set.has(x.subject)).slice(0, 30);
}

async function responseJson({ instructions, input, schema, name, effort, maxOutputTokens }) {
  const body = {
    model: OPENAI_MODEL,
    reasoning: { effort },
    instructions,
    input,
    store: false,
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name,
        strict: true,
        schema,
      },
    },
  };

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();

  if (!r.ok) {
    const msg = data?.error?.message || `OpenAI API ${r.status}`;
    throw new Error(msg);
  }

  if (data?.status === 'incomplete') {
    const reason = data?.incomplete_details?.reason || 'unknown';
    const used = data?.usage?.output_tokens ?? '?';
    const reasoningUsed = data?.usage?.output_tokens_details?.reasoning_tokens ?? '?';
    throw new Error(`OpenAI 응답이 중단되었습니다 (${reason}). 출력 ${used} / reasoning ${reasoningUsed} tokens.`);
  }

  const text = outputText(data);
  if (!text) {
    const status = data?.status || 'unknown';
    const types = Array.isArray(data?.output) ? data.output.map(x => x?.type).filter(Boolean).join(',') : 'none';
    throw new Error(`OpenAI 응답에 문제 데이터가 없습니다. status=${status}, output=${types || 'none'}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('OpenAI가 문제를 생성했지만 JSON 해석에 실패했습니다.');
  }
}

async function generateToeic(dayNumber, review, recent) {
  const toeicRecent = onlyRecent(recent, ['TOEIC Part 6','TOEIC Part 7']);

  const instructions = `
너는 실제 TOEIC Reading 실전문항 출제자다. 모델은 GPT-5.6 Sol이다.
초급 학습용이 아니라 TOEIC 800~900점대 수험생이 실전 연습할 수준으로 만든다.

[Part 6]
- 하나의 완결된 비즈니스 문서 135~275 English words.
- 4문항.
- 단순 품사 문제는 최대 1개. 어휘/연어, 문맥, 응집성, 문장 삽입·연결관계 등을 섞는다.
- 보기 네 개 모두 실제로 헷갈릴 만해야 한다.

[Part 7]
- 하나의 완결된 지문 180~360 English words.
- 2문항.
- 둘 다 단순 한 문장 복사형으로 만들지 않는다.
- 최소 1개는 추론/목적/의도/paraphrase/복수 정보 결합을 요구한다.

[정답 형식]
- answer_letter는 반드시 A/B/C/D 중 하나다.
- A=첫 번째 보기, B=두 번째, C=세 번째, D=네 번째.
- 숫자 인덱스를 쓰지 않는다.

[해설]
- 정답 근거를 구체적으로 설명하고, 중요한 TOEIC 어휘·표현은 vocab에 짧게 정리한다.
- 같은 세트 안에서 다른 문항의 정답을 노골적으로 누설하지 않는다.
`;

  const input = `
Day ${dayNumber} TOEIC Part 6 + Part 7 세트를 생성하라.

[최근 영어 정오답]
${summarizeAnswers(toeicRecent)}

실제 시험에 출제될 법한 문서 유형과 문장 밀도를 유지하고, 지나치게 짧거나 쉬운 지문은 금지한다.
`;

  const data = await responseJson({
    instructions,
    input,
    schema: toeicSchema(),
    name: 'toeic_daily_set',
    effort: 'medium',
    maxOutputTokens: 6500,
  });

  return flattenToeic(data);
}

async function generateCoreExam(dayNumber, notes, review, recent) {
  const expectedSteps = ACTIVE_TRACK === 'current'
    ? ['민법','물리','화학','생물']
    : ['민법','특허법','상표법','디자인보호법','물리','화학','생물'];

  const examRecent = onlyRecent(recent, expectedSteps);

  const instructions = `
너는 대한민국 변리사 1차 시험 실전문항 출제자다. 모델은 GPT-5.6 Sol이며 reasoning은 High로 사용한다.
사용자는 고등학교 물리학 I·화학 I·생명과학 I 기본개념을 이미 충분히 알고 있으므로 초급 확인문제는 금지한다.

[공통]
- 각 과목은 5지선다 1문항.
- answer_letter는 반드시 A/B/C/D/E 중 하나. A=첫 번째 보기, E=다섯 번째 보기. 숫자 인덱스 금지.
- 정답이 하나만 존재하게 독립 검토한다.
- 원칙/예외, 성립요건/대항요건, 시점, 인과관계, 보존법칙, 제한조건 등 경계조건을 적극 활용한다.
- 쉬운 오답이나 한 단어만 보고 제거되는 선지를 피한다.

[민법 — 가장 중요]
- 변리사 1차 민법개론 기출 수준을 하한선으로 한다.
- 사용자가 제시한 기출 예시처럼 5개 선지가 각각 판례·요건·효과에 관한 완성된 명제여야 한다.
- 단순 정의형/단답형 금지.
- 독립선지형 또는 복합사례형 모두 가능.
- 적어도 2개 이상의 법리·판례 포인트를 구별하게 한다.
- 원칙/예외, 성립요건/대항요건, 당사자효/제3자효, 소멸/행사불가, 추정/입증책임 등을 적극 활용한다.
- 5개 선지 중 최소 4개는 40자 이상의 실질적 법률명제가 되게 한다.
- 해설은 A~E 각 선지를 따로 검토한다.
- 사용자 참고자료는 약점 탐지용이다. 자료가 부정확하면 그대로 답으로 쓰지 말고 확립된 법리·판례를 우선한다.

[물리]
- 대학 일반물리 + 변리사 자연과학개론 기출급.
- 역학·회전·유체·열역학·파동·전기자기·광학·현대물리를 순환.
- 최소 2단계 추론/식 결합. 단순 공식 대입 금지.
- 해설에서 각 선택지가 왜 맞고 틀리는지 설명.

[화학]
- 대학 일반화학 + 변리사 기출급.
- 원자구조·결합·열화학·평형·산염기·용해도·전기화학·속도론·기초 유기화학 순환.
- 개념 2개 이상 결합 또는 자료 해석.
- 해설에서 각 선택지를 검토.

[생물]
- 대학 일반생물/세포·분자생물 + 변리사 기출급.
- 대사·유전·분자생물·세포·동물/식물생리·진화·생태 순환.
- 실험결과·경로·조절·인과관계 해석 위주.
- 해설에서 각 선택지를 검토.

${ACTIVE_TRACK === 'patent_focus' ? `
[특허법·상표법·디자인보호법]
- 각 과목도 변리사 1차 기출급.
- 단순 조문 암기만으로 끝내지 말고 기간·주체·절차·효과·예외·심판구조를 구별하게 한다.
- 확신하지 못하는 판례번호나 조문번호를 만들어내지 않는다.
` : ''}
`;

  const input = `
Day ${dayNumber}의 다음 과목을 생성하라: ${expectedSteps.join(', ')}.

[최근 복습 우선순위]
${summarizeReview(review)}

[최근 관련 정오답]
${summarizeAnswers(examRecent)}

[사용자가 직접 모은 법과목 참고자료]
${notes || '추가 자료 없음'}

최근 오답은 사실관계·수치·표현을 변형하여 재검사하되, 같은 개념만 단독으로 묻는 쉬운 재출제는 금지한다.
`;

  const data = await responseJson({
    instructions,
    input,
    schema: examSchema(expectedSteps),
    name: 'patent_exam_daily_set',
    effort: 'high',
    maxOutputTokens: ACTIVE_TRACK === 'current' ? 9000 : 12000,
  });

  return flattenExam(data);
}

async function callOpenAI({ dayNumber, notes, review, recent }) {
  // 속도/안정성 개선:
  // current 트랙은 TOEIC(Sol Medium)과 변리사 핵심(Sol High)을 병렬 생성한다.
  // 민법 참고자료는 법/자연과학 호출에만 들어가 영어 생성에 낭비되지 않는다.
  if (ACTIVE_TRACK === 'current') {
    const [toeic, core] = await Promise.all([
      generateToeic(dayNumber, review, recent),
      generateCoreExam(dayNumber, notes, review, recent),
    ]);
    return { questions: [...toeic, ...core] };
  }

  // patent_focus는 현재 영어가 없으므로 한 번의 High 호출로 생성한다.
  const core = await generateCoreExam(dayNumber, notes, review, recent);
  return { questions: core };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_API_KEY) {
    return send(res, 500, { error: 'Vercel Environment Variables 설정이 필요합니다.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return send(res, 401, { error: '로그인이 필요합니다.' });

  try {
    const user = await sbFetch(SUPABASE_URL, '/auth/v1/user', token, SUPABASE_ANON_KEY, { method: 'GET' });
    const uid = user?.id;
    if (!uid) return send(res, 401, { error: '사용자 확인 실패' });

    const dayNumber = Math.max(1, Number(req.body?.dayNumber || 1));
    if (!Number.isInteger(dayNumber) || dayNumber > 10000) return send(res, 400, { error: '잘못된 Day 번호입니다.' });

    const cached = await sbFetch(
      SUPABASE_URL,
      `/rest/v1/daily_questions?select=questions,model,prompt_version,generated_at&user_id=eq.${uid}&day_number=eq.${dayNumber}&limit=1`,
      token,
      SUPABASE_ANON_KEY,
      { method: 'GET' }
    );
    if (Array.isArray(cached) && cached[0]?.questions?.length) {
      // 비용 가드: 한 번 생성된 Day는 프롬프트 버전이 바뀌어도 자동 재생성하지 않는다.
      // 새 난도/과목 구성은 다음 Day부터 적용된다.
      return send(res, 200, {
        ...cached[0],
        cached: true,
        legacy_prompt: cached[0].prompt_version !== PROMPT_VERSION,
      });
    }

    const [sources, review, recent] = await Promise.all([
      sbFetch(SUPABASE_URL, ACTIVE_TRACK === 'patent_focus'
        ? `/rest/v1/study_sources?select=title,tags,source_text,updated_at&user_id=eq.${uid}&subject=in.(%EB%AF%BC%EB%B2%95,%ED%8A%B9%ED%97%88%EB%B2%95,%EC%83%81%ED%91%9C%EB%B2%95,%EB%94%94%EC%9E%90%EC%9D%B8%EB%B3%B4%ED%98%B8%EB%B2%95)&order=updated_at.desc&limit=24`
        : `/rest/v1/study_sources?select=title,tags,source_text,updated_at&user_id=eq.${uid}&subject=eq.%EB%AF%BC%EB%B2%95&order=updated_at.desc&limit=20`,
        token, SUPABASE_ANON_KEY, { method: 'GET' }),
      sbFetch(SUPABASE_URL, `/rest/v1/review_items?select=concept_key,ease,interval_days,repetitions,last_reviewed_at,next_review_at&user_id=eq.${uid}&order=next_review_at.asc&limit=20`, token, SUPABASE_ANON_KEY, { method: 'GET' }),
      sbFetch(SUPABASE_URL, `/rest/v1/answer_log?select=question_id,day_number,step,result,concept_key,subject,answered_at&user_id=eq.${uid}&order=answered_at.desc&limit=50`, token, SUPABASE_ANON_KEY, { method: 'GET' }),
    ]);

    const notes = sourceDigest(sources, review, recent);
    // 자동 재시도는 하지 않는다.
    // current 트랙은 TOEIC과 변리사 핵심을 2개 병렬 호출로 생성해 체감 대기시간과 형식 오류를 줄인다.
    // 실패 시 사용자가 명시적으로 '다시 시도'를 눌렀을 때만 재호출한다.
    const generated = await callOpenAI({ dayNumber, notes, review, recent });
    const questions = validateAndNormalize(generated.questions, dayNumber);

    const row = {
      user_id: uid,
      day_number: dayNumber,
      questions,
      model: OPENAI_MODEL,
      prompt_version: PROMPT_VERSION,
      generated_at: new Date().toISOString(),
    };

    const saved = await sbFetch(
      SUPABASE_URL,
      '/rest/v1/daily_questions?on_conflict=user_id,day_number',
      token,
      SUPABASE_ANON_KEY,
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      }
    );

    return send(res, 200, {
      questions: saved?.[0]?.questions || questions,
      model: OPENAI_MODEL,
      prompt_version: PROMPT_VERSION,
      generated_at: row.generated_at,
      cached: false,
    });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err?.message || '문제 생성 중 오류가 발생했습니다.' });
  }
};
