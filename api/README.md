# jungsan-decrypt-api

비밀번호 보호된 Excel 거래내역서를 복호화하는 FastAPI 서버.

## Render 배포 방법

1. render.com → New Web Service
2. Connect: `niju0114/jungsan` 저장소
3. **Root Directory**: `api`
4. **Build Command**: `pip install -r requirements.txt`
5. **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. **Environment Variables**:
   - `CORS_ORIGIN`: `https://jungsan-hae.com,https://www.jungsan-hae.com`

## 로컬 실행

```bash
cd api
pip install -r requirements.txt
uvicorn main:app --reload
# http://localhost:8000
```

## 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/health` | 서버 상태 확인 (콜드 스타트 워밍업용) |
| POST | `/decrypt` | 파일 복호화 — `multipart/form-data`: `file` (xlsx), `password` (string) |

## 보안

- CORS: `CORS_ORIGIN` 환경변수로 허용 도메인 제한
- 파일 크기: 10 MB 제한
- Rate limit: IP당 10회/분
- 메모리 처리: 디스크 저장 없음
- 비밀번호: 로그 기록 없음
