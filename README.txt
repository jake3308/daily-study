v9 LAZY GENERATION PATCH

왜 바꿨나
- 이전 구조: 하루 10문제 + 해설을 한꺼번에 생성. High reasoning이 9,000 output token 한도를 먹어버리면
  돈은 쓰고 daily_questions에는 아무것도 저장되지 않는 구조였음.
- v9: 필요한 단계만 그때 생성하고, 성공한 묶음은 즉시 Supabase에 저장.

실행 순서
1. GitHub 루트 app.js 교체
2. GitHub api/generate-day.js 교체
3. Commit
4. Vercel 배포 Ready 확인
5. 사이트 Ctrl+F5

SQL 수정 없음.
Vercel 환경변수 수정 없음.

현재 생성 순서
- 접속 직후: TOEIC Part 6 4문제만 생성/저장
- Part 6 완료 시: Part 7 2문제 생성/저장
- 이후 민법 1 → 물리 1 → 화학 1 → 생물 1을 필요한 순간에만 생성
- 민법만 Sol High + 사용자 민법자료
- TOEIC/자연과학은 Sol Medium
- 자동 재시도 없음

중요
- 한 단계가 실패해도 그 전에 성공해서 저장된 문제는 사라지지 않음.
- 문제 난도 때문에 결과를 생성 후 버리는 '길이 검증'을 제거해, 유료 출력을 낭비하지 않음.
