# white space — 재배치 판정 AI 에이전트

발사체 부품(동체외벽) 검수에서, 결함이 있는 부품을 "버릴지 말지"가 아니라
"어디에 쓸지" 판단하는 AI 에이전트입니다. 자세한 배경은 [docs/intent.md](docs/intent.md),
기능/화면 명세는 [docs/spec.md](docs/spec.md) 참고.

## 아키텍처

```
[Next.js(App Router), TS]  <-- HTTP(기본 localhost:8000) -->  [FastAPI, Python]
  업로드/조회/채팅 UI                                            judge.py 물리판정
       |                                                        + surrogate 추론
       v  Claude API(Anthropic SDK, tool-use)
       |
  [Supabase(PostgreSQL, JSONB)] — 회차·부품·판정·리포트·채팅이력·검사원결정 저장
```

- **GPU는 필수가 아닙니다.** 팀은 학교 GPU 서버(H200)를 편의상 사용했을 뿐,
  물리 판정 로직(judge.py/api.py)은 pandas/numpy 기반이라 CPU로도 그대로
  동작합니다. surrogate 신경망(torch)도 GPU 없으면 자동으로 CPU로 돕니다.

## 사전 준비물

- Node.js 20 이상 (개발 시 v24 사용)
- Python 3.11 이상 (개발 시 3.12 사용)
- Supabase 프로젝트 (무료 플랜으로 충분) — [supabase.com](https://supabase.com)
- Anthropic API 키 — [console.anthropic.com](https://console.anthropic.com)

## 설치

```bash
# 1. 저장소 클론 후 이동
git clone https://github.com/ksows004-commits/white-space.git
cd white-space

# 2. Next.js 의존성 설치
npm install

# 3. Python 의존성 설치 (가상환경 권장)
pip install -r requirements.txt
```

## 환경변수 설정

```bash
cp .env.example .env.local
```

`.env.local`을 열어 아래 값을 채우세요 (각 변수 설명은 `.env.example` 참고):

- `ANTHROPIC_API_KEY` — AI 리포트/채팅/트리아지 기능에 필요
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — 검사 회차 데이터 저장소
- `GPU_API_URL` — 생략하면 `http://localhost:8000` 기본값 사용

## Supabase 테이블 생성

Supabase 프로젝트의 SQL Editor에서 [supabase/schema.sql](supabase/schema.sql) 내용을
그대로 실행하면 `inspection_batches` 테이블이 만들어집니다.

## 실행

두 서버를 각각 띄웁니다 (터미널 2개).

```bash
# 터미널 1 — 물리 판정 서버 (FastAPI)
uvicorn api:app --host 0.0.0.0 --port 8000 --reload

# 터미널 2 — 웹 애플리케이션 (Next.js)
npm run dev
```

브라우저에서 http://localhost:3000 접속. `GET http://localhost:8000/health` 가
`{"status":"ok"}`를 반환하면 판정 서버가 정상 기동된 것입니다.

## 바로 테스트해보기

`sample-data/` 폴더에 바로 업로드해볼 수 있는 검사 CSV 3종이 있습니다
(결함 없음/있음이 현실적 비율로 섞여 있어 Pass/Conditional Pass가 둘 다 나옵니다).
회차 목록 화면(`/`)에서 "검사 파일 업로드"로 그중 하나를 선택하면 됩니다.

시나리오 기반 고정 데모(`/scenarios`)도 있어 CSV 없이 바로 기능을 둘러볼 수
있습니다.

## 주요 디렉터리

| 경로 | 내용 |
|---|---|
| `src/app/` | Next.js 페이지·API 라우트 |
| `src/lib/` | AI 에이전트 로직(리포트/채팅/트리아지/작업지시서), 타입 |
| `judge.py`, `api.py` | 물리 판정 엔진 + FastAPI 서버 |
| `surrogate_model.py`, `train_surrogate.py` | 응력 예측 신경망 |
| `docs/` | 기획·명세·기술설명 문서 |
| `supabase/schema.sql` | DB 테이블 스키마 |

## 더 읽어보기

- [docs/intent.md](docs/intent.md) — 무엇을, 왜 만드는지
- [docs/spec.md](docs/spec.md) — 화면·기능·데이터 명세
- [docs/scenarios.md](docs/scenarios.md) — 시나리오 데모 상세
- [docs/tech-description-material.txt](docs/tech-description-material.txt) — 기술 상세(물리 모델, AI 에이전트 구조, surrogate 모델 성능 등)
