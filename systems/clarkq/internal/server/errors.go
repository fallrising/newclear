package server

import "errors"

var (
	errUnauthorized    = errors.New("unauthorized")
	errForbidden       = errors.New("forbidden")
	errReplication     = errors.New("replication failed")
	errQuorum          = errors.New("write quorum not met")
	errStaleEpoch      = errors.New("stale cluster epoch")
	errOwnerGrace      = errors.New("owner grace period active")
	errNotOwner        = errors.New("not queue owner under current membership")
	errLease           = errors.New("lease not acquired")
	errTenantQuota     = errors.New("tenant quota exceeded")
	errTenantRate      = errors.New("tenant enqueue rate exceeded")
	errTenantForbidden = errors.New("queue belongs to another tenant")
)