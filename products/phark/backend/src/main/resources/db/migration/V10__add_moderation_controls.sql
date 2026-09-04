-- Additive V10 moderation persistence (SDD-011). Creates three internal-only tables
-- (restart-persistent rate-limit buckets, content reports, minimized abuse signals)
-- plus their CHECK/FK/partial-unique/retention indexes. Explicitly additive: no ALTER
-- of V1-V9 objects and no backfill of historical origin signals (legacy post/reply IP
-- origins are unknown). Every FK and ON DELETE action below is explicit; dependent
-- moderation rows cascade on target/reporter/actor deletion, and no moderation table
-- can cascade into accounts, posts, replies, interactions, notifications, or media.

CREATE TABLE abuse_rate_limit_buckets (
    scope              TEXT    NOT NULL CHECK (scope IN ('REGISTER', 'LOGIN', 'CONTENT_WRITE', 'SOCIAL_WRITE', 'REPORT_WRITE')),
    subject_kind       TEXT    NOT NULL CHECK (subject_kind IN ('ACCOUNT', 'IP')),
    subject_hmac       TEXT    NOT NULL
        CHECK (length(subject_hmac) = 64
               AND subject_hmac = lower(subject_hmac)
               AND subject_hmac NOT GLOB '*[^0-9a-f]*'),
    window_start_epoch INTEGER NOT NULL,
    window_end_epoch   INTEGER NOT NULL,
    expires_at_epoch   INTEGER NOT NULL,
    request_count      INTEGER NOT NULL CHECK (request_count > 0),
    PRIMARY KEY (scope, subject_kind, subject_hmac, window_start_epoch),
    CHECK (window_end_epoch > window_start_epoch),
    CHECK (expires_at_epoch = window_end_epoch + 86400),
    CHECK ((scope IN ('REGISTER', 'LOGIN') AND subject_kind = 'IP')
        OR (scope IN ('CONTENT_WRITE', 'SOCIAL_WRITE', 'REPORT_WRITE')
            AND subject_kind IN ('ACCOUNT', 'IP')))
);

CREATE INDEX idx_abuse_rate_limit_buckets_expiry
    ON abuse_rate_limit_buckets(expires_at_epoch);

CREATE TABLE content_reports (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    target_type         TEXT    NOT NULL CHECK (target_type IN ('POST', 'REPLY')),
    post_id             INTEGER          REFERENCES posts(id) ON DELETE CASCADE,
    reply_id            INTEGER          REFERENCES replies(id) ON DELETE CASCADE,
    reason              TEXT    NOT NULL
        CHECK (reason IN ('SPAM', 'HARASSMENT', 'HATE_OR_VIOLENCE', 'SEXUAL_CONTENT', 'OTHER')),
    status              TEXT    NOT NULL CHECK (status = 'RECEIVED'),
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at_epoch    INTEGER NOT NULL,
    CHECK ((target_type = 'POST' AND post_id IS NOT NULL AND reply_id IS NULL)
        OR (target_type = 'REPLY' AND reply_id IS NOT NULL AND post_id IS NULL))
);

CREATE UNIQUE INDEX uq_content_reports_reporter_post
    ON content_reports(reporter_account_id, post_id)
    WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX uq_content_reports_reporter_reply
    ON content_reports(reporter_account_id, reply_id)
    WHERE reply_id IS NOT NULL;

CREATE INDEX idx_content_reports_expiry
    ON content_reports(expires_at_epoch);

CREATE TABLE abuse_signals (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    action_kind      TEXT    NOT NULL CHECK (action_kind IN ('POST_CREATED', 'REPLY_CREATED', 'REPORT_CREATED')),
    actor_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    post_id          INTEGER          REFERENCES posts(id) ON DELETE CASCADE,
    reply_id         INTEGER          REFERENCES replies(id) ON DELETE CASCADE,
    report_id        INTEGER          REFERENCES content_reports(id) ON DELETE CASCADE,
    ip_hmac          TEXT    NOT NULL
        CHECK (length(ip_hmac) = 64
               AND ip_hmac = lower(ip_hmac)
               AND ip_hmac NOT GLOB '*[^0-9a-f]*'),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at_epoch INTEGER NOT NULL,
    CHECK ((action_kind = 'POST_CREATED' AND post_id IS NOT NULL AND reply_id IS NULL AND report_id IS NULL)
        OR (action_kind = 'REPLY_CREATED' AND reply_id IS NOT NULL AND post_id IS NULL AND report_id IS NULL)
        OR (action_kind = 'REPORT_CREATED' AND report_id IS NOT NULL AND post_id IS NULL AND reply_id IS NULL))
);

CREATE UNIQUE INDEX uq_abuse_signals_post
    ON abuse_signals(post_id)
    WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX uq_abuse_signals_reply
    ON abuse_signals(reply_id)
    WHERE reply_id IS NOT NULL;

CREATE UNIQUE INDEX uq_abuse_signals_report
    ON abuse_signals(report_id)
    WHERE report_id IS NOT NULL;

CREATE INDEX idx_abuse_signals_ip_time
    ON abuse_signals(ip_hmac, created_at);

CREATE INDEX idx_abuse_signals_actor_time
    ON abuse_signals(actor_account_id, created_at);

CREATE INDEX idx_abuse_signals_expiry
    ON abuse_signals(expires_at_epoch);