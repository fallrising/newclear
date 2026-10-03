-- A public-tariff money rehearsal on the local fixture.  These values are
-- estimates, never an actual provider bill or a production hard money limit.
-- Keep 008's real amount/currency/price_revision NULL constraint intact.
ALTER TABLE model_proxy_runs
    ADD COLUMN quote_price_revision text,
    ADD COLUMN quote_limit_nanodollars bigint CHECK (quote_limit_nanodollars > 0),
    ADD COLUMN quote_expires_at timestamptz,
    ADD CONSTRAINT quote_run_shape CHECK (
        (quote_price_revision IS NULL AND quote_limit_nanodollars IS NULL
         AND quote_expires_at IS NULL)
        OR
        (quote_price_revision IS NOT NULL AND quote_limit_nanodollars IS NOT NULL
         AND quote_expires_at IS NOT NULL)
    );

ALTER TABLE model_proxy_requests
    ADD COLUMN quote_input_bound bigint CHECK (quote_input_bound > 0),
    ADD COLUMN quote_output_bound bigint CHECK (quote_output_bound > 0),
    ADD COLUMN quote_reserved_nanodollars bigint CHECK (quote_reserved_nanodollars >= 0),
    ADD COLUMN quote_settled_nanodollars bigint CHECK (quote_settled_nanodollars >= 0),
    ADD CONSTRAINT quote_request_shape CHECK (
        (quote_reserved_nanodollars IS NULL AND quote_input_bound IS NULL
         AND quote_output_bound IS NULL AND quote_settled_nanodollars IS NULL)
        OR
        (quote_reserved_nanodollars IS NOT NULL AND quote_input_bound IS NOT NULL
         AND quote_output_bound IS NOT NULL
         AND (quote_settled_nanodollars IS NULL OR
              (status='final' AND quote_settled_nanodollars <= quote_reserved_nanodollars)))
    );
