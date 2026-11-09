-- One persisted cap per merchant and UTC day, shared by API, worker and buyer processes.
CREATE TABLE ai_daily_usage (
  merchant_id text NOT NULL,
  utc_day date NOT NULL,
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  daily_limit bigint NOT NULL CHECK (daily_limit >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, utc_day)
);

CREATE INDEX ai_daily_usage_day_idx ON ai_daily_usage (utc_day);
