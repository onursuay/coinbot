-- Migration 0026: trade_learning_events table for Paper Learning Mode.
--
-- Each row captures one phase in the lifecycle of a paper trade used by the
-- learning subsystem: opened → updated → closed → outcome_analyzed →
-- lesson_created → rule_suggestion_created.
--
-- The table is queried by the dashboard for win/loss-by-bypass stats and by
-- the lesson engine for outcome analysis. Insertion failure must NEVER block
-- paper trade flow — writers degrade gracefully if this table is missing.
--
-- Apply via Supabase SQL Editor (DDL is not exposed via REST).

create table if not exists trade_learning_events (
  id              uuid          primary key default gen_random_uuid(),
  paper_trade_id  uuid          null,
  symbol          text          null,
  direction       text          null,
  event_type      text          not null,
  event_json      jsonb         null,
  llm_summary     text          null,
  created_at      timestamptz   not null default now()
);

create index if not exists idx_trade_learning_events_paper_trade_id
  on trade_learning_events (paper_trade_id);

create index if not exists idx_trade_learning_events_event_type_created_at
  on trade_learning_events (event_type, created_at desc);

create index if not exists idx_trade_learning_events_symbol_created_at
  on trade_learning_events (symbol, created_at desc);

-- Optional check on event_type values. Kept loose so future event types can be
-- added without a migration; downstream code should treat unknown types as
-- forward-compatible.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trade_learning_events_event_type_check'
  ) then
    alter table trade_learning_events
      add constraint trade_learning_events_event_type_check
      check (event_type in (
        'opened', 'updated', 'closed', 'outcome_analyzed',
        'lesson_created', 'rule_suggestion_created'
      ));
  end if;
end $$;

comment on table trade_learning_events is
  'Paper Learning Mode event log. One row per lifecycle phase of a paper trade. Best-effort: missing rows are tolerated.';
