UI 개선 패치 v8

교체할 파일:
- index.html
- styles.css
- app.js  (화면의 모델 표기만 "Sol · High"로 간소화)

건드리지 말 것:
- config.js
- api/generate-day.js (v7.1 출력 패치 그대로 유지)
- vercel.json
- Supabase SQL

GitHub 저장소 루트에서 위 3개 파일만 교체하고 Commit 하면 Vercel이 자동 재배포합니다.
