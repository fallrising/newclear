-- Synthetic fixture credits exercise conservative reservation/settlement.
-- Real provider money remains unknown; 008's amount_decimal NULL constraint stays.
ALTER TABLE model_proxy_runs
    ADD COLUMN fixture_price_revision text,
    ADD COLUMN fixture_limit_microcredits bigint CHECK (fixture_limit_microcredits > 0),
    ADD CONSTRAINT fixture_budget_pair CHECK
        ((fixture_price_revision IS NULL) = (fixture_limit_microcredits IS NULL));

ALTER TABLE model_proxy_requests
    ADD COLUMN fixture_input_bound bigint CHECK (fixture_input_bound > 0),
    ADD COLUMN fixture_output_bound bigint CHECK (fixture_output_bound > 0),
    ADD COLUMN fixture_reserved_microcredits bigint CHECK (fixture_reserved_microcredits >= 0),
    ADD COLUMN fixture_settled_microcredits bigint CHECK (fixture_settled_microcredits >= 0),
    ADD CONSTRAINT fixture_request_budget_shape CHECK (
        (fixture_reserved_microcredits IS NULL AND fixture_input_bound IS NULL
         AND fixture_output_bound IS NULL AND fixture_settled_microcredits IS NULL)
        OR
        (fixture_reserved_microcredits IS NOT NULL AND fixture_input_bound IS NOT NULL
         AND fixture_output_bound IS NOT NULL
         AND (fixture_settled_microcredits IS NULL OR
              (status='final' AND fixture_settled_microcredits <= fixture_reserved_microcredits)))
    );
