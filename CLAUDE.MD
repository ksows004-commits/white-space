# 프로젝트 가이드라인

## 기술 스택 (임의로 바꾸지 말 것)

- Next.js (App Router) — 화면과 서버를 함께 만드는 웹 프레임워크

- TypeScript — 실수를 미리 잡아주는 언어

- Tailwind CSS — 화면 꾸미기

- Supabase — 데이터 저장. 필요할 때만 쓴다 (안 쓰면 추가하지 않는다)

- Vercel — 배포

새 라이브러리는 꼭 필요할 때만, 왜 필요한지 먼저 설명하고 추가한다.

## 작업 방식

- 한 번에 하나씩. 큰 작업은 쪼개서 순서를 먼저 알려준다.

- 만들기 전에 계획을 요약하고, 컨펌을 받은 뒤 실행한다.

- 요청하지 않은 기능은 만들지 않는다.

- 수정할 때는 요청한 부분만 고친다. 나머지는 그대로 둔다.

- 한 단계가 끝나면 화면에서 어떻게 확인하는지 알려준다.

- 언제든 배포할 수 있는 상태를 유지한다.

-복잡한 계산은 직접 하지 말고 gpu서버를 통해 대신 계산한다.(수식이나 계산해야하는 코드등을 주면 gpu서버에서 연산한 결과값을 알려줌

## 대화 방식

- 전문 용어를 쓰면 괄호로 쉬운 설명을 덧붙인다.

- 내가 잘못 알고 있으면 정정한다. 안 되는 것은 안 된다고 말한다.

- 되물을 때는 한 번에 2개까지만 질문한다.

## 문서

- docs/[intent.md](http://intent.md) — 무엇을, 왜, 어떤 제약으로 (기획)

- docs/[spec.md](http://spec.md) — 화면 · 기능 · 데이터 · 걱정되는 점 · 확인 방법 (명세)

- 이 두 문서와 다르게 만들지 않는다. 방향을 바꿔야 하면 문서를 먼저 고친다.

- 같은 실수를 두 번 하면, 이 파일에 규칙으로 추가하자고 제안한다.

## 완료 전에 확인

- "다 됐다"고 말하기 전에 npm run build 가 오류 없이 끝나는지 직접 확인한다.

- 확인에 실패하면 고친 뒤 다시 확인한다. 확인을 건너뛰거나 숨기지 않는다.

## 안전

- 비밀번호와 API 키는 코드에 직접 쓰지 않는다. .env.local 에 넣는다.

- 파일을 지우거나 되돌리기 전에 반드시 먼저 물어본다.

- 커밋은 작게, 자주. 무엇을 했는지 한국어로 적는다.

## 명령어

- 개발 서버 실행: npm run dev

- 배포 전 확인: npm run build


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
