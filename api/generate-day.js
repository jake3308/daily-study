const OPENAI_MODEL = 'gpt-5.6-sol';
const PROMPT_VERSION = 'v9-lazy-stage-generation';
const CURRENT_STAGES = [
  { step: 'TOEIC Part 6', count: 4 },
  { step: 'TOEIC Part 7', count: 2 },
  { step: '민법', count: 1 },
  { step: '물리', count: 1 },
  { step: '화학', count: 1 },
  { step: '생물', count: 1 },
];
const PATENT_STAGES = [
  { step: '민법', count: 1 },
  { step: '특허법', count: 1 },
  { step: '상표법', count: 1 },
  { step: '디자인보호법', count: 1 },
  { step: '물리', count: 1 },
  { step: '화학', count: 1 },
  { step: '생물', count: 1 },
];
const ACTIVE_TRACK = process.env.STUDY_TRACK === 'patent_focus' ? 'patent_focus' : 'current';
const STAGES = ACTIVE_TRACK === 'patent_focus' ? PATENT_STAGES : CURRENT_STAGES;
const TOTAL = STAGES.reduce((n, s) => n + s.count, 0);
const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const MAX_SOURCE_CHARS = 6000;

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function headers(token, anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sbFetch(base, path, token, anonKey, options = {}) {
  const r = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...headers(token, anonKey), ...(options.headers || {}) },
  });
  const raw = await r.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!r.ok) {
    const msg = data?.message || data?.error_description || `Supabase ${r.status}`;
    throw new Error(msg);
  }
  return data;
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

async function responseJson({ instructions, input, schema, name, effort, maxOutputTokens }) {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort },
      store: false,
      max_output_tokens: maxOutputTokens,
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema,
        },
      },
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI API ${r.status}`);

  if (data?.status === 'incomplete') {
    const reason = data?.incomplete_details?.reason || 'unknown';
    const used = data?.usage?.output_tokens ?? '?';
    const reasoning = data?.usage?.output_tokens_details?.reasoning_tokens ?? '?';
    throw new Error(`OpenAI 응답 중단(${reason}) · 출력 ${used}, reasoning ${reasoning} tokens`);
  }

  const text = outputText(data);
  if (!text) throw new Error(`OpenAI 응답에 문제 데이터가 없습니다. status=${data?.status || 'unknown'}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('생성된 문제 JSON을 해석하지 못했습니다.');
  }
}

function simpleQuestionSchema(choiceCount) {
  const letters = choiceCount === 4 ? ['A','B','C','D'] : ['A','B','C','D','E'];
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      meta: { type: 'string' },
      passage: { type: 'string' },
      question: { type: 'string' },
      choices: {
        type: 'array',
        minItems: choiceCount,
        maxItems: choiceCount,
        items: { type: 'string' },
      },
      answer_letter: { type: 'string', enum: letters },
      explanation: { type: 'string' },
      vocab: { type: 'string' },
      concept: { type: 'string' },
      difficulty: { type: 'string' },
    },
    required: ['meta','passage','question','choices','answer_letter','explanation','vocab','concept','difficulty'],
  };
}

function toeicSetSchema(count) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      passage: { type: 'string' },
      questions: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            meta: { type: 'string' },
            question: { type: 'string' },
            choices: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'string' },
            },
            answer_letter: { type: 'string', enum: ['A','B','C','D'] },
            explanation: { type: 'string' },
            vocab: { type: 'string' },
            concept: { type: 'string' },
            difficulty: { type: 'string' },
          },
          required: ['meta','question','choices','answer_letter','explanation','vocab','concept','difficulty'],
        },
      },
    },
    required: ['passage','questions'],
  };
}

function normalize(q, step, passage, absoluteIndex) {
  const letter = String(q.answer_letter || '').toUpperCase();
  const answer = LETTER_TO_INDEX[letter];
  const choices = Array.isArray(q.choices) ? q.choices.map(String) : [];
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) {
    throw new Error(`${step} 정답 형식 오류`);
  }
  return {
    id: `d__DAY__-q${String(absoluteIndex + 1).padStart(2, '0')}`,
    step,
    meta: String(q.meta || '').trim(),
    passage: String(passage ?? q.passage ?? '').trim(),
    question: String(q.question || '').trim(),
    choices,
    answer,
    explanation: String(q.explanation || '').trim(),
    vocab: String(q.vocab || '').trim(),
    concept: String(q.concept || step).trim(),
    difficulty: String(q.difficulty || '').trim(),
  };
}

function countsOf(questions) {
  const c = {};
  for (const q of questions || []) c[q.step] = (c[q.step] || 0) + 1;
  return c;
}

function nextStage(questions) {
  const counts = countsOf(questions);
  for (const s of STAGES) {
    if ((counts[s.step] || 0) < s.count) return s;
  }
  return null;
}

function summarizeAnswers(items, step) {
  const filtered = (items || []).filter(x => x.step === step || x.subject === step).slice(0, 12);
  if (!filtered.length) return '아직 이 과목의 누적 정오답 없음.';
  return filtered.map((x, i) =>
    `${i + 1}. Day ${x.day_number} / ${x.result}${x.concept_key ? ` / ${x.concept_key}` : ''}`
  ).join('\n');
}

function summarizeReview(items) {
  if (!items?.length) return '아직 누적 복습 기록 없음.';
  return items.slice(0, 12).map((x, i) =>
    `${i + 1}. ${x.concept_key} / 반복 ${x.repetitions ?? 0} / 간격 ${x.interval_days ?? 1}일`
  ).join('\n');
}

function digestSources(sources, recent, review) {
  const targetText = [
    ...(recent || []).filter(x => x.result === 'wrong' || x.result === 'unsure').map(x => x.concept_key || ''),
    ...(review || []).slice(0, 8).map(x => x.concept_key || ''),
  ].join(' ');

  const chunks = [];
  for (const s of sources || []) {
    const lines = String(s.source_text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 8) {
      const chunk = lines.slice(i, i + 8).join('\n').trim();
      if (!chunk) continue;
      let score = 1;
      for (const t of targetText.split(/\s+/).filter(x => x.length >= 2)) {
        if (chunk.includes(t)) score += 5;
      }
      chunks.push({ score, text: `### ${s.title}\n${chunk}` });
    }
  }
  chunks.sort((a,b) => b.score - a.score);
  let out = '';
  for (const c of chunks) {
    const block = `${c.text}\n\n`;
    if ((out + block).length > MAX_SOURCE_CHARS) continue;
    out += block;
    if (out.length > MAX_SOURCE_CHARS * 0.9) break;
  }
  return out || '추가 참고자료 없음.';
}

function englishWordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

async function generateToeicPart6(day, recent, offset) {
  const data = await responseJson({
    effort: 'medium',
    maxOutputTokens: 3600,
    name: 'toeic_part6',
    schema: toeicSetSchema(4),
    instructions: `
실제 TOEIC Reading Part 6 출제자처럼 작성한다.
난도는 800~900점대 실전 수준이며 쉬운 교재형 문제는 금지한다.
하나의 자연스러운 업무 문서에 [1] [2] [3] [4] 네 빈칸을 만들고 4문항을 낸다.
지문은 140~240 English words 정도.
문항 유형은 어휘·연어, 문맥/응집성, 문법, 문장 연결을 섞되 단순 품사형은 최대 1개.
선택지는 모두 실제 오답으로 기능할 정도로 그럴듯하게 만든다.
answer_letter는 A/B/C/D 중 하나.
해설은 정답 근거를 분명히 하되 장황하지 않게 2~5문장.
`,
    input: `Day ${day} Part 6을 생성하라.\n최근 영어 정오답:\n${summarizeAnswers(recent, 'TOEIC Part 6')}`,
  });

  const wc = englishWordCount(data.passage);
  if (wc < 110) throw new Error(`Part 6 지문이 너무 짧습니다(${wc} words).`);
  return data.questions.map((q, i) => normalize(q, 'TOEIC Part 6', data.passage, offset + i));
}

async function generateToeicPart7(day, recent, offset) {
  const data = await responseJson({
    effort: 'medium',
    maxOutputTokens: 3000,
    name: 'toeic_part7',
    schema: toeicSetSchema(2),
    instructions: `
실제 TOEIC Reading Part 7 출제자처럼 작성한다.
난도는 800~900점대 실전 수준.
하나의 이메일/공지/기사/메모/웹페이지 등 실제 시험에 나올 법한 지문을 190~330 English words로 작성한다.
2문항 모두 한 문장 복사로 끝나지 않게 하고, 최소 1문항은 추론·목적·의도·paraphrase·복수정보 결합을 요구한다.
answer_letter는 A/B/C/D 중 하나.
해설은 정답 근거와 핵심 paraphrase를 짧고 정확하게 설명한다.
`,
    input: `Day ${day} Part 7을 생성하라.\n최근 영어 정오답:\n${summarizeAnswers(recent, 'TOEIC Part 7')}`,
  });

  const wc = englishWordCount(data.passage);
  if (wc < 150) throw new Error(`Part 7 지문이 너무 짧습니다(${wc} words).`);
  return data.questions.map((q, i) => normalize(q, 'TOEIC Part 7', data.passage, offset + i));
}

async function generateLaw(step, day, sources, recent, review, offset) {
  const notes = digestSources(sources, recent, review);
  const isCivil = step === '민법';

  const instructions = isCivil ? `
대한민국 변리사 1차 민법개론 실전 출제자다.
사용자가 제시한 실제 기출 수준을 하한선으로 한다.
단답형·정의형·한 법리만 바로 떠올리면 풀리는 문제는 금지한다.
5지선다이며 정답은 하나.
독립선지형 또는 복합사례형으로 만들고, 적어도 2개 이상의 판례 법리/요건/효과/시점을 구별하게 한다.
선지 5개가 모두 판례형 완성명제여야 하고, 쉬운 낚시 선지는 금지한다.
원칙·예외, 성립요건·대항요건, 당사자효·제3자효, 소멸·행사제한, 추정·입증책임 같은 경계선을 적극 활용한다.
사용자 메모는 약점 참고용일 뿐이며 틀린 메모를 정답으로 받아들이지 않는다.
확신 없는 판례번호는 쓰지 않는다.
해설은 A~E 각 선지를 각각 검토하되 필요한 핵심만 쓴다.
answer_letter는 A/B/C/D/E 중 하나.
` : `
대한민국 변리사 1차 ${step} 실전 출제자다.
5지선다, 정답 하나. 단순 조문 단답형은 금지하고 절차·기간·주체·효과·예외를 결합한다.
기출에서 요구하는 정도의 정교한 함정과 구별을 사용한다.
확신 없는 조문번호·판례번호는 만들어내지 않는다.
해설은 A~E 각 선지를 각각 검토한다.
answer_letter는 A/B/C/D/E 중 하나.
`;

  const data = await responseJson({
    effort: 'high',
    maxOutputTokens: 7000,
    name: `law_${step === '민법' ? 'civil' : 'subject'}`,
    schema: simpleQuestionSchema(5),
    instructions,
    input: `Day ${day} ${step} 1문항을 생성하라.

[최근 정오답]
${summarizeAnswers(recent, step)}

[복습 우선순위]
${summarizeReview(review)}

[사용자 참고자료 — 관련 부분만 추림]
${notes}
`,
  });

  return [normalize(data, step, '', offset)];
}

async function generateScience(step, day, recent, review, offset) {
  const focus = {
    '물리': '대학 일반물리 + 변리사 자연과학개론. 역학·회전·유체·열·파동·전자기·광학·현대물리에서 순환. 최소 2단계 추론 또는 식 결합. 고교 개념 확인형과 단순 공식 대입 금지.',
    '화학': '대학 일반화학 + 변리사 자연과학개론. 원자구조·결합·열화학·평형·산염기·용해도·전기화학·속도론·기초유기에서 순환. 최소 두 개 개념을 결합하거나 자료를 해석하게 한다.',
    '생물': '대학 일반생물/세포·분자생물 + 변리사 자연과학개론. 대사·유전·분자·세포·동물/식물생리·진화·생태에서 순환. 실험결과·경로·조절·인과관계를 해석하게 한다.',
  }[step];

  const data = await responseJson({
    effort: 'medium',
    maxOutputTokens: 3600,
    name: `science_${step === '물리' ? 'physics' : step === '화학' ? 'chemistry' : 'biology'}`,
    schema: simpleQuestionSchema(5),
    instructions: `
너는 대한민국 변리사 1차 자연과학개론 실전 출제자다.
사용자는 고등학교 ${step} 기본 수준은 이미 충분히 숙달했던 학습자다.
${focus}
5지선다, 정답 하나. 보기들은 모두 같은 수준의 그럴듯한 오답이어야 한다.
해설은 풀이에 필요한 대학 수준 개념을 복구할 수 있게 설명하고 각 보기의 핵심 오류도 짚는다.
answer_letter는 A/B/C/D/E 중 하나.
`,
    input: `Day ${day} ${step} 1문항을 생성하라.

[최근 정오답]
${summarizeAnswers(recent, step)}

[복습 우선순위]
${summarizeReview(review)}
`,
  });

  return [normalize(data, step, '', offset)];
}

async function generateStage(stage, day, ctx, offset) {
  if (stage === 'TOEIC Part 6') return generateToeicPart6(day, ctx.recent, offset);
  if (stage === 'TOEIC Part 7') return generateToeicPart7(day, ctx.recent, offset);
  if (['민법','특허법','상표법','디자인보호법'].includes(stage)) {
    return generateLaw(stage, day, ctx.sources, ctx.recent, ctx.review, offset);
  }
  return generateScience(stage, day, ctx.recent, ctx.review, offset);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !process.env.OPENAI_API_KEY) {
    return send(res, 500, { error: 'Vercel Environment Variables 설정이 필요합니다.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return send(res, 401, { error: '로그인이 필요합니다.' });

  try {
    const user = await sbFetch(SUPABASE_URL, '/auth/v1/user', token, SUPABASE_ANON_KEY, { method: 'GET' });
    const uid = user?.id;
    if (!uid) return send(res, 401, { error: '사용자 확인 실패' });

    const day = Math.max(1, Number(req.body?.dayNumber || 1));
    if (!Number.isInteger(day) || day > 10000) return send(res, 400, { error: '잘못된 Day 번호입니다.' });

    const rows = await sbFetch(
      SUPABASE_URL,
      `/rest/v1/daily_questions?select=questions,model,prompt_version,generated_at&user_id=eq.${uid}&day_number=eq.${day}&limit=1`,
      token, SUPABASE_ANON_KEY, { method: 'GET' }
    );
    const existingRow = Array.isArray(rows) ? rows[0] : null;
    const existing = Array.isArray(existingRow?.questions) ? existingRow.questions : [];

    const stageObj = nextStage(existing);
    if (!stageObj) {
      return send(res, 200, {
        questions: existing,
        model: OPENAI_MODEL,
        prompt_version: existingRow?.prompt_version || PROMPT_VERSION,
        generated_at: existingRow?.generated_at,
        cached: true,
        complete: true,
        expected_total: TOTAL,
      });
    }

    let recent = [];
    let review = [];
    let sources = [];

    if (stageObj.step.startsWith('TOEIC')) {
      recent = await sbFetch(
        SUPABASE_URL,
        `/rest/v1/answer_log?select=day_number,step,result,concept_key,subject,answered_at&user_id=eq.${uid}&order=answered_at.desc&limit=30`,
        token, SUPABASE_ANON_KEY, { method: 'GET' }
      );
    } else {
      [recent, review] = await Promise.all([
        sbFetch(
          SUPABASE_URL,
          `/rest/v1/answer_log?select=day_number,step,result,concept_key,subject,answered_at&user_id=eq.${uid}&order=answered_at.desc&limit=40`,
          token, SUPABASE_ANON_KEY, { method: 'GET' }
        ),
        sbFetch(
          SUPABASE_URL,
          `/rest/v1/review_items?select=concept_key,ease,interval_days,repetitions,last_reviewed_at,next_review_at&user_id=eq.${uid}&order=next_review_at.asc&limit=20`,
          token, SUPABASE_ANON_KEY, { method: 'GET' }
        ),
      ]);

      if (['민법','특허법','상표법','디자인보호법'].includes(stageObj.step)) {
        const subject = encodeURIComponent(stageObj.step);
        sources = await sbFetch(
          SUPABASE_URL,
          `/rest/v1/study_sources?select=title,tags,source_text,updated_at&user_id=eq.${uid}&subject=eq.${subject}&order=updated_at.desc&limit=20`,
          token, SUPABASE_ANON_KEY, { method: 'GET' }
        );
      }
    }

    const generated = await generateStage(stageObj.step, day, { recent, review, sources }, existing.length);
    const patched = generated.map((q, i) => ({
      ...q,
      id: `d${day}-q${String(existing.length + i + 1).padStart(2, '0')}`,
    }));

    const questions = [...existing, ...patched];

    const row = {
      user_id: uid,
      day_number: day,
      questions,
      model: OPENAI_MODEL,
      prompt_version: PROMPT_VERSION,
      generated_at: new Date().toISOString(),
    };

    const saved = await sbFetch(
      SUPABASE_URL,
      '/rest/v1/daily_questions?on_conflict=user_id,day_number',
      token, SUPABASE_ANON_KEY,
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
      generated_stage: stageObj.step,
      complete: questions.length >= TOTAL,
      expected_total: TOTAL,
    });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err?.message || '문제 생성 중 오류가 발생했습니다.' });
  }
};
