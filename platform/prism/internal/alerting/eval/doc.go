// Package eval runs loaded Prometheus rule groups and keeps pending and firing
// alerts. Each group has its own loop at the loader's stored interval.
// File rules use the empty tenant. annotations.prism_log_expr is not executed.
//
// cmd/prismd is outside this phase, so the loops start when a caller invokes
// Engine.Start. GET /prom/api/v1/rules and GET /prom/api/v1/alerts read Engine
// through promapi.SetRules.
package eval
