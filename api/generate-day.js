const OPENAI_MODEL = 'gpt-5.6-sol';
const PROMPT_VERSION = 'v7.1-sol-high-output-fix';
const MAX_OUTPUT_TOKENS = 16000;
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

function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        minItems: Object.values(EXPECTED).reduce((a,b) => a + b, 0),
        maxItems: Object.values(EXPECTED).reduce((a,b) => a + b, 0),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            step: { type: 'string', enum: Object.keys(EXPECTED) },
            meta: { type: 'string' },
            passage: { type: 'string' },
            question: { type: 'string' },
            choices: { type: 'array', minItems: 4, maxItems: 5, items: { type: 'string' } },
            answer: { type: 'integer', minimum: 0, maximum: 4 },
            explanation: { type: 'string' },
            vocab: { type: 'string' },
            concept: { type: 'string' },
            difficulty: { type: 'string' },
          },
          required: ['id','step','meta','passage','question','choices','answer','explanation','vocab','concept','difficulty'],
        },
      },
    },
    required: ['questions'],
  };
}

function englishWordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function totalTextLength(q) {
  return String(q.question || '').length + (q.choices || []).reduce((n, x) => n + String(x || '').length, 0);
}

function validateAndNormalize(questions, dayNumber) {
  const expectedTotal = Object.values(EXPECTED).reduce((a,b) => a + b, 0);
  if (!Array.isArray(questions) || questions.length !== expectedTotal) throw new Error(`생성된 문항 수가 ${expectedTotal}개가 아닙니다.`);
  const counts = {};
  questions.forEach((q, idx) => {
    counts[q.step] = (counts[q.step] || 0) + 1;
    const expectedChoices = (q.step === 'TOEIC Part 6' || q.step === 'TOEIC Part 7') ? 4 : 5;
    if (!Array.isArray(q.choices) || q.choices.length !== expectedChoices) {
      throw new Error(`${q.step} 선택지 수가 ${expectedChoices}개가 아닙니다.`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      throw new Error(`${q.step} 정답 인덱스가 잘못되었습니다.`);
    }
    q.id = `d${dayNumber}-q${String(idx + 1).padStart(2, '0')}`;
    q.meta = String(q.meta || '').trim();
    q.passage = String(q.passage || '').trim();
    q.question = String(q.question || '').trim();
    q.explanation = String(q.explanation || '').trim();
    q.vocab = String(q.vocab || '').trim();
    q.concept = String(q.concept || q.step).trim();
    q.difficulty = String(q.difficulty || '').trim();
  });
  for (const [step, n] of Object.entries(EXPECTED)) {
    if ((counts[step] || 0) !== n) throw new Error(`${step} 문항 구성이 잘못되었습니다.`);
  }
  const part6 = questions.filter(q => q.step === 'TOEIC Part 6');
  const part7 = questions.filter(q => q.step === 'TOEIC Part 7');
  if (part6.length) {
    if (new Set(part6.map(q => q.passage)).size !== 1) throw new Error('Part 6는 하나의 지문을 공유해야 합니다.');
    const p6Words = englishWordCount(part6[0]?.passage);
    if (p6Words < 125 || p6Words > 285) throw new Error(`Part 6 지문 길이가 실전 범위를 크게 벗어났습니다 (${p6Words} words).`);
  }
  if (part7.length) {
    if (new Set(part7.map(q => q.passage)).size !== 1) throw new Error('Part 7은 하나의 지문을 공유해야 합니다.');
    const p7Words = englishWordCount(part7[0]?.passage);
    if (p7Words < 165 || p7Words > 380) throw new Error(`Part 7 지문 길이가 실전 범위를 크게 벗어났습니다 (${p7Words} words).`);
  }

  const civil = questions.find(q => q.step === '민법');
  if (!civil || totalTextLength(civil) < 420 || civil.choices.filter(x => String(x).length >= 40).length < 4) {
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
    if (!q || totalTextLength(q) < 240) throw new Error(`${step} 문항이 지나치게 단순합니다.`);
  }
  return questions;
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

async function callOpenAI({ dayNumber, notes, review, recent }) {
  const system = `
너는 대한민국 변리사 1차 시험과 TOEIC을 함께 준비하는 상위권 수험생의 일일 문제 출제자다.
모델은 GPT-5.6 Sol이며, 각 문항을 실제 시험 문항처럼 깊게 검토한 뒤 정답이 하나뿐인 문제만 만든다.
쉬운 학습용 예제나 단순 암기 확인 문제가 아니라, 실전에서 틀릴 만한 경계조건·함정·추론을 포함해야 한다.

[공통 구성]
1) 하루 구성은 현재 트랙 설정을 정확히 따른다: ${Object.entries(EXPECTED).map(([k,v]) => `${k} ${v}문항`).join(', ')}.
2) 직전 오답/헷갈림/복습 대상은 우선 반영하되, 동일 문구·숫자·사례를 반복하지 않는다.
3) 이미 안정적으로 맞힌 개념은 간격을 늘리고, 아직 덜 다룬 범위도 계속 섞는다.
4) 사용자 민법 참고자료는 약점과 관심 포인트를 파악하는 자료다. 내용이 틀렸거나 애매하면 그대로 정답 근거로 사용하지 말고 확립된 법리와 판례에 따라 독립 검토한다. 판례번호를 확신하지 못하면 만들지 않는다.
5) 복수정답 가능성, 사실관계 부족, 선지 간 중복, 지나치게 쉬운 오답이 있으면 그 문항은 폐기하고 다시 작성한다.

[TOEIC Part 6 — 실제 시험 밀도]
- 난도는 실제 TOEIC Part 6의 중상~상 난도. 수능식 문학 영어가 아니라 회사 이메일, 공지, 안내문, 기사, 고객 안내, 내부 메모 등 비즈니스 실무 문체를 사용한다.
- 4문항은 반드시 하나의 동일한 지문을 공유한다. 지문은 140~260 English words 정도로 충분한 맥락을 갖춘 완결된 실무 문서여야 한다.
- 4문항은 품사/문법 1개 이하, 어휘·연어, 문맥상 의미, 문장 삽입·응집성·대명사/연결 관계 등 실제 Part 6의 서로 다른 판단을 섞는다. 단순 품사형만 연속 출제 금지.
- 선택지는 모두 실제 TOEIC에서 헷갈릴 법한 후보로 만든다. 의미상 전혀 안 맞는 쉬운 오답, 형태만 다른 초급 선택지 남발 금지.
- 문장 삽입형은 앞뒤 문장의 논리 연결을 실제로 추론해야 풀 수 있게 한다.

[TOEIC Part 7 — 실제 시험 밀도]
- 2문항은 반드시 하나의 동일한 지문을 공유한다. 지문은 180~340 English words 정도.
- 단순 한 문장 찾기만으로 둘 다 풀리지 않게 하고, 2문항 중 최소 1개는 추론, 목적/의도, paraphrase, 특정 정보 결합 중 하나를 요구한다.
- 정답 문구가 지문에 그대로 반복되는 방식보다 paraphrase를 적극 사용한다.
- 어휘는 실제 TOEIC 비즈니스·서비스·행정 상황에서 자주 나오는 수준으로 하되, 지나치게 전문적인 배경지식은 요구하지 않는다.

[민법 — 변리사 1차 기출급, 가장 중요]
- 사용자는 단순 정의형/단답형을 원하지 않는다. 변리사 1차 민법개론 기출 수준의 고밀도 5지선다를 출제한다.
- 실제 기출을 복제하지 말고, 기출의 사고 구조·판례 함정·문장 밀도를 재현한다.
- 허용되는 대표 형식은 두 가지다.
  A) 독립선지형: '불법행위에 관한 설명으로 옳지 않은 것은?'처럼 짧은 공통 질문 아래, 5개 선지가 각각 별개의 판례·요건·효과를 정확히 판별하게 하는 형식.
  B) 사례형: 하나의 복잡한 사실관계에서 여러 시점·당사자·제3자·대항관계·효과를 결합해 판단하는 형식.
- 독립선지형의 경우 짧은 질문이어도 괜찮지만, 5개 선지 대부분은 충분히 길고 법률효과가 촘촘해야 한다. 한두 단어만 보고 제거 가능한 선지는 금지.
- 사례형의 경우 최소 2~4개의 법리를 동시에 구별하게 하고, 시점·입증책임·선의/악의·과실·제3자 보호·등기/인도·소급효·담보권·상계·채권양도·채무인수·대위/취소·임대차·조합·불법행위 등을 교차시킬 수 있다.
- 정답은 법률효과의 미세한 차이에서 갈리게 한다. '원칙/예외', '성립요건/대항요건', '당사자효/제3자효', '소멸/행사불가', '추정/입증책임'을 적극 활용한다.
- 사용자가 예시로 제시한 정도의 밀도, 즉 각 선지가 판례 문장에 가까운 완성된 명제로 구성되고 5개 모두 검토 가치가 있는 수준을 하한선으로 본다.
- 해설은 반드시 ①~⑤ 각각을 별도로 판단하여 왜 맞고 틀리는지 설명한다. 정답만 설명 금지.
- 최근 약점은 변형 출제하되, 그 약점 하나만 물어보는 단순 문제로 만들지 말고 주변 법리와 연결한다.

[물리 — 변리사 자연과학개론 기출급]
- 사용자는 고등학교 물리학 I 수준의 기본개념은 이미 숙달한 사람이다. 고등학교 정의·공식 대입 한 단계 문제 금지.
- 대학 일반물리학 수준의 개념과 계산을 중심으로 한다: 역학/회전/중력, 유체, 열역학, 진동·파동, 전기장·전위·회로·축전기, 자기·전자기유도, 광학, 현대물리/원자·핵.
- 적어도 2단계 이상의 추론 또는 식의 결합이 필요하게 하고, 단위/극한/방향/보존법칙을 이용한 함정을 포함할 수 있다.
- 계산형이면 숫자만 바꾼 고교 문제보다 관계식 해석과 조건 선택이 핵심이 되게 한다.

[화학 — 변리사 자연과학개론 기출급]
- 고등학교 화학 I 수준의 단순 주기율·몰 계산·정의 문제 금지. 대학 일반화학 중심으로 한다.
- 원자구조/양자수/주기성, 결합·분자구조, 기체, 열화학, 화학평형, 산염기·완충, 용해도, 전기화학, 반응속도, 기초 유기화학을 폭넓게 순환한다.
- 평형식, 로그 관계, 열역학 부호, 전위·평형상수 관계, 반응차수 등 개념을 2개 이상 결합하거나 자료를 해석하게 한다.
- 선택지는 계산 실수뿐 아니라 개념적 오개념을 반영한 그럴듯한 오답으로 구성한다.

[생물 — 변리사 자연과학개론 기출급]
- 고등학교 생명과학 I의 단순 암기형 금지. 대학 일반생물학/세포·분자생물학 중심으로 한다.
- 세포생물학, 대사, 분자생물학, 유전학, 동물생리, 식물생리, 진화, 생태를 순환한다.
- 실험 결과, 유전 교배, 신호전달 경로, 효소/대사 조절, 막수송, 호르몬/신경생리 등에서 자료 해석 또는 인과관계를 묻게 한다.
- 명칭 암기 하나로 끝나는 문제보다 여러 단계의 원인-결과를 추론하게 한다.

${ACTIVE_TRACK === 'patent_focus' ? `
[특허법·상표법·디자인보호법 — 향후 전환 트랙]
- 각 과목은 변리사 1차 기출급 5지선다 1문항씩 출제한다. 단순 조문 암기만으로 끝내지 말고 절차·기간·주체·효과·예외·판례 또는 심사/심판 구조를 함께 구별하게 한다.
- 법령·판례·심사기준의 확실한 내용만 사용한다. 정확성을 확신하지 못하는 조문번호·판례번호는 만들어내지 않는다.
- 특허법은 출원/우선권/보정/분할/변경/심사/거절/심판/무효/권리범위/실시권 등, 상표법은 등록요건/사용/유사/취소·무효/권리효과 등, 디자인보호법은 성립·신규성·관련디자인·부분디자인·출원·심판·권리효과 등을 폭넓게 순환한다.
` : ''}
[해설 원칙]
- 문제는 어렵게 내되, 해설은 사용자가 잊은 개념을 복구할 수 있도록 기초 원리부터 짧고 정확하게 연결한다.
- 물리/화학/생물은 정답 근거뿐 아니라 5개 오답이 왜 틀렸는지 각각 짚는다.
- 모든 과목에서 문제 난도는 '쉬운 워밍업'이 아니라 실제 시험 대비용으로 유지한다.

출력은 스키마에 맞는 JSON만 반환한다.`;

  const user = `
Day ${dayNumber} 문제를 생성하라. 현재 트랙은 ${ACTIVE_TRACK}이다.

[최근 복습 우선순위]
${summarizeReview(review)}

[최근 정오답 기록]
${summarizeAnswers(recent)}

[사용자가 직접 모은 법과목 참고자료]
${notes || '추가 자료 없음'}

추가 조건:
- 오늘 전체 문항을 실제 변리사/TOEIC 실전 대비 수준으로 만든다. 초급 학습문제 수준이면 실패다.
${ACTIVE_TRACK === 'current' ? '- TOEIC Part 6 지문은 140~260 words, Part 7 지문은 180~340 words를 지킨다.' : '- 영어는 출제하지 않는다. 특허법·상표법·디자인보호법은 각각 변리사 1차 기출급 5지선다로 출제한다.'}
- 민법은 사용자가 제시한 변리사 기출 예시 정도의 선지 밀도와 판례 구별 난도를 최소 기준으로 삼는다.
- 민법 5개 선지는 모두 길이와 정보량이 충분하고, 최소 4개는 40자 이상의 실질적 법률명제가 되게 한다.
- 자연과학은 고등학교 물1/화1/생1 수준의 기본개념 확인을 넘어서 대학 일반과학 + 변리사 기출급으로 만든다.
- 최근 오답은 변형 재검사하되, 그 개념만 단독으로 묻는 쉬운 재출제는 금지한다.
- 같은 Day 안에서 서로 정답을 누설하지 않는다.`;

  const body = {
    model: OPENAI_MODEL,
    reasoning: { effort: 'high' },
    instructions: system,
    input: user,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: 'json_schema',
        name: 'daily_study_questions',
        strict: true,
        schema: schema(),
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
    throw new Error(`OpenAI 응답이 완성되기 전에 중단되었습니다 (${reason}). 출력 ${used} tokens / reasoning ${reasoningUsed} tokens. 다시 시도하지 말고 generate-day.js의 출력 한도를 확인하세요.`);
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
    // 비용 가드: 새 Day당 자동 생성 호출은 정확히 1회만 한다.
    // 구조/품질 검증 실패 시 자동으로 2번째 API 호출을 하지 않고, 화면의 재시도 버튼으로 사용자가 명시적으로 다시 시도한다.
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
