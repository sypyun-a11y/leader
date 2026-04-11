# Leaderboard App

## 실행

1. 환경 변수 설정
   - `.env.example`를 복사해서 `.env`로 만듭니다.
   - `REDASH_API_URL`, `REDASH_API_KEY`, `REDASH_QUERY_ID`, `DATABASE_URL` 값을 채웁니다.

2. 의존성 설치
   ```bash
   npm install
   ```

3. 로컬 실행
   ```bash
   npm start
   ```

## 배포 (Railway)

1. Railway에 로그인하고 새 프로젝트를 만듭니다.
2. `Connect Database`로 PostgreSQL 플러그인을 연결합니다.
3. `Environment`에 다음 변수를 추가합니다:
   - `REDASH_API_URL`
   - `REDASH_API_KEY`
   - `REDASH_QUERY_ID`
   - `DATABASE_URL` (Railway에서 자동으로 생성)
   - `REFRESH_INTERVAL` (선택)
4. Git 리포지토리를 Railway에 연결하거나 `railway up`을 사용합니다.

## 주요 파일

- `server.js`: Express 서버 및 PostgreSQL/Redash API 연결
- `public/index.html`: 메인 사용자 UI
- `public/admin.html`: 관리자 승인 페이지
- `public/app.js`: 클라이언트 로직
- `public/style.css`: 스타일
