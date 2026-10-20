// Package state stores alert for-timers in Postgres alert_state.
//
// The SQL files in migrations are applied by this package. The version table
// is alerting_schema_migrations. golang-migrate's schema_migrations is not used.
// File rules use the empty tenant id. P5-01 must not rebuild this table; see
// 07-ALERTING.md §11.4.
package state
