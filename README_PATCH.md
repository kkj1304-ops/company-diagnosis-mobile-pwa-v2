# 국내 전체 종목명 검색 보강 패치

## 바뀌는 점
- 6자리 코드 입력 시 `.KS`와 `.KQ`를 모두 시도합니다.
- `두산에너빌리티` 등 누락된 주요 기업 매핑을 추가합니다.
- Yahoo summary API가 401로 막혀도 차트 가격 데이터로 앱이 계속 동작합니다.
- Vercel 환경변수 `DART_API_KEY`를 넣으면 OpenDART `corpCode.xml`을 이용해 국내 상장사 종목명을 자동 검색합니다.

## GitHub에 덮어쓸 파일
- `app/api/analyze/route.ts`
- `lib/tickers.ts`
- `package.json`

## Vercel 환경변수
Project Settings → Environment Variables에서 아래를 추가하세요.

```text
DART_API_KEY=본인_OpenDART_인증키
```

환경변수를 추가한 뒤 반드시 Redeploy 하세요.
