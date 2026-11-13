-- 챗봇 대화 로그 (관리자 품질 개선용, hub-chatbot Edge Function이 service_role로만 기록/조회)
-- 2026-09-11, [[project-hr-hub]] "온보딩 허브 고도화 + 챗봇" 참고
create table if not exists chat_logs (
  id bigint generated always as identity primary key,
  user_email text,
  user_name text,
  employee_type text,
  message text not null,
  reply text not null,
  model text, -- 실제 답변한 Gemini 모델(무료한도 초과로 폴백된 빈도 파악용 — 유료 전환 설득 근거)
  created_at timestamptz not null default now()
);

alter table chat_logs enable row level security;
-- anon/authenticated 정책을 아예 만들지 않음 = 기본 거부, service_role(Edge Function)만 접근 가능
-- (webauthn_credentials 테이블과 동일 패턴, [[project-hr-hub]] 참고)

create index if not exists chat_logs_created_at_idx on chat_logs(created_at desc);
