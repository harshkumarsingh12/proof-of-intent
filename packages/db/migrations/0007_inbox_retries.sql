-- A dispute event that fails every time must not occupy the worker's batch forever (#164). Each claim counts an
-- attempt and leases the row, so several workers can run; a failure schedules the next attempt, and after enough of them
-- the event is quarantined (kept, visible, no longer retried) so newer disputes are not blocked behind it.
alter table webhook_events
  add column attempts        int         not null default 0,
  add column next_attempt_at timestamptz, -- null until a failure schedules a retry: a fresh event is due at once
  add column claimed_until   timestamptz,
  add column last_error      text,
  add column quarantined_at  timestamptz;

drop index webhook_events_unprocessed_idx;
create index webhook_events_due_idx on webhook_events ((coalesce(next_attempt_at, received_at)), received_at)
  where processed_at is null and quarantined_at is null;
