v7.1 출력한도 수정 패치

1) GitHub daily-study 저장소에서 api/generate-day.js만 이 파일로 교체합니다.
2) Commit changes 합니다.
3) Vercel이 자동 재배포되면 사이트를 새로고침합니다.

변경사항:
- GPT-5.6 Sol + High reasoning 그대로 유지
- max_output_tokens 8,500 -> 16,000
- 토큰 한도 때문에 응답이 incomplete인 경우 원인을 화면에 구체적으로 표시
- 자동 재시도 없음(비용 가드 유지)

중요: max_output_tokens는 '무조건 쓰는 토큰 수'가 아니라 상한입니다.
