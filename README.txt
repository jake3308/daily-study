v9.3 — TOEIC passage-group flow

TOEIC UI/flow
- Part 6 = passage 1개 + 그 지문에 연결된 4문제
- 한 문제 선택 -> 즉시 정오답/해설 표시 -> '다음 문제'
- 4문제 모두 끝난 뒤에만 Part 7 지문으로 이동
- Part 7 = passage 1개 + 그 지문에 연결된 2문제
- 한 문제 선택 -> 해설 -> 다음 문제
- Part 7 두 문제를 모두 풀고 나서 민법으로 이동
- Part 6/7 문제를 바꿀 때 같은 그룹에서는 같은 passage가 계속 표시됨
- 상단 진행률도 1/10이 아니라 Part 6에서는 1/4~4/4, Part 7에서는 1/2~2/2
- question meta에 '오늘 n/10'은 보조 정보로 표시

Generation
- Part 6 prompt에서 문항별 독립 지문 금지, passage 하나에 [1]~[4] 빈칸을 연결
- Part 7 prompt에서 문항별 독립 지문 금지, 두 문제 모두 같은 passage를 근거로 출제
- 기존 v9.2의 '품질 때문에 생성 결과 폐기하지 않음' 정책 유지
- 단계별 저장/선행 생성 구조 유지
- SQL / Vercel env 변경 없음

교체 파일
1. app.js
2. api/generate-day.js
