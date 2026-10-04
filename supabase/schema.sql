-- Supabase SQL Editor에서 그대로 실행하면 이 프로젝트가 필요로 하는 테이블이
-- 만들어집니다. (Project > SQL Editor > New query > 붙여넣기 > Run)

create table if not exists inspection_batches (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- 회차(배치)에 속한 부품 배열 전체. 판정 결과, AI 리포트, 재배치 작업지시서,
  -- 채팅 이력, 검사원 승인/반려 기록까지 부품 객체 하나에 전부 포함되는 구조.
  -- 정확한 타입은 src/lib/types.ts의 BatchPart를 참고하세요.
  parts jsonb not null default '[]'::jsonb,
  -- 회차 종합 분석(공정 문제 vs 재료 편차) — 처음엔 비어있다가 배치 트리아지
  -- 실행(POST /api/batches/[id]/triage) 시 채워짐.
  synthesis text
);

comment on table inspection_batches is '검사 회차(배치) 단위로 부품 판정 결과 전체를 저장';
comment on column inspection_batches.parts is 'BatchPart[] — 판정/리포트/작업지시서/채팅이력/검사원결정 전부 포함 (src/lib/types.ts 참고)';
