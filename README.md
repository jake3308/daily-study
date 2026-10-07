# 오늘 공부 사이트 — Starter v2

PC/폰에서 같은 계정으로 학습기록을 이어가고, 민법 참고자료를 계속 추가할 수 있는 버전입니다.

## 핵심 규칙

- Day는 날짜가 아니라 **완료한 학습일 수**입니다.
- 하루를 건너뛰면 Day는 증가하지 않습니다.
- 중간에 종료하면 다음 접속 때 **같은 Day의 같은 다음 문제**부터 이어집니다.
- 하루 루틴을 전부 끝내고 `오늘 완료하고 다음 Day로`를 눌러야 Day +1 됩니다.
- 정오답과 민법 참고자료는 Supabase DB에 저장되므로 사이트 코드를 수정/재배포해도 유지됩니다.

## 민법 참고자료 기능

로그인 후 오른쪽 위 `민법 자료` 버튼에서 다음을 할 수 있습니다.

- 새 메모 붙여넣기
- 제목 + 태그 저장
- TXT/MD 파일 불러오기 후 저장
- 저장된 자료 목록 확인
- 수정용으로 다시 불러오기
- 삭제
- 전체 자료를 TXT 하나로 내보내기

이 폴더의 `민법_기존_참고자료.txt`는 사용자가 이전에 정리해둔 자료를 넣어둔 것입니다. 사이트에서 `민법 자료` → `TXT/MD 파일 불러오기`로 한 번 저장하면 이후 PC/폰 어디서든 계정에 동기화됩니다.

> 현재 버전은 **텍스트 자료를 확실하게 저장하는 단계**입니다. PDF/사진을 올리고 AI가 자동으로 읽어 매일 문제를 생성하게 하려면 추후 서버 함수 + AI API 파이프라인을 붙이는 것이 좋습니다.

## 1) Supabase 만들기

1. https://supabase.com 에서 Free 프로젝트 생성
2. SQL Editor에서 `supabase.sql` 전체 실행
   - 이미 이전 버전을 실행했다면 이번 `supabase.sql`을 다시 실행해도 됩니다. `if not exists`로 되어 있습니다.
3. Authentication > Providers > Email 활성화
4. Project Settings > API에서 Project URL / anon public key 확인
5. `config.example.js`를 `config.js`로 복사하고 두 값을 입력

> 브라우저에 들어가는 anon key는 공개 가능한 키입니다. service_role key는 절대 넣지 마세요.

## 2) 로컬 확인

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속.

## 3) Vercel 배포

이 폴더를 GitHub 저장소에 올린 뒤 Vercel에서 Import 하면 됩니다. 정적 사이트라 별도 빌드 명령이 없어도 됩니다.

Supabase Authentication > URL Configuration에서 Site URL을 Vercel 주소로 바꾸고 Redirect URLs에도 같은 주소를 추가하세요.

## 4) 기존 민법 자료 넣기

1. 사이트 로그인
2. `민법 자료`
3. `TXT/MD 파일 불러오기`
4. 이 ZIP에 들어 있는 `민법_기존_참고자료.txt` 선택
5. 제목 예: `기존 민법 오답/헷갈림 정리`
6. `자료 저장`

그 뒤부터는 새로 헷갈린 내용을 같은 화면에서 계속 추가하면 됩니다.

## 5) 문제 추가

현재 Day별 실제 문제는 `questions.js`에 있습니다.

```js
window.STUDY_QUESTION_BANK = {
  1: [/* Day 1 */],
  2: [/* Day 2 */],
  3: [/* Day 3 */]
};
```

문제 ID는 재사용하지 않는 것이 좋습니다.

## 다음 확장 추천

- 민법 문제 생성 시 `study_sources`에서 관련 태그/약점 자료를 자동 검색
- answer_log + review_items 기반 Anki식 간격반복
- `헷갈림` 버튼 추가
- PDF/이미지 자료 업로드 + 텍스트 추출
- 매일 자동 문제 생성 파이프라인

## 비용

개인 학습용 규모는 Vercel Hobby + Supabase Free로 시작할 수 있습니다. AI가 매일 자동으로 새 문제를 생성하도록 OpenAI API 등을 연결하면 해당 API 비용은 별도입니다.
