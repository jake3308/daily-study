Daily Study v7 — 이번에 할 것만

A. Supabase
- SQL Editor에서 FINAL_SETUP_ONCE.sql 전체를 딱 1번 Run.
- 예전에 실행한 base/fix/grant/v5_schema SQL은 다시 실행하지 않음.
- 이 SQL은 기존 일부가 이미 있어도 안전하게 보완하도록 작성됨.

B. GitHub daily-study
아래 파일/폴더를 저장소 루트에 업로드해서 기존 파일은 교체:
- index.html
- app.js
- styles.css
- vercel.json
- 민법_기존_참고자료.txt
- api/generate-day.js  (중요: api 폴더 안에 있어야 함)

기존 config.js는 절대 지우거나 교체하지 않음.
questions.js는 더 이상 필요 없음. 남아 있어도 작동에는 문제 없음.

C. Vercel > daily-study > Settings > Environment Variables
필수 3개:
1) OPENAI_API_KEY = OpenAI에서 만든 secret key
2) SUPABASE_URL = https://pdbgbrwyvxdzgsqatuxh.supabase.co
3) SUPABASE_ANON_KEY = Supabase의 sb_publishable_... 공개키 (기존 config.js의 값과 동일)

- 현재 영어 유지이므로 STUDY_TRACK은 만들지 않음.
- Environment는 Production 체크. Preview도 테스트하고 싶으면 함께 체크.
- 저장 후 새 Deploy가 필요함. GitHub Commit을 환경변수 저장 후 하면 자동 새 배포됨.

D. 최종 테스트
- https://daily-study-rho.vercel.app 접속
- 로그인
- 새 Day에 문제가 없으면 /api/generate-day가 Sol High로 딱 1회 생성
- 생성된 Day는 daily_questions에 저장되어 다시 접속해도 API 재호출 없음
- Day 전체 완료 전에는 다음 Day로 넘어가지 않음
