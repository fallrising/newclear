package db

import (
	"database/sql"
	"io/fs"
	"testing"
	"testing/fstest"
)

func legacyDB(t *testing.T, mode string) *sql.DB {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	d.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = d.Close() })
	b, err := fs.ReadFile(SQLFiles, "sql/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(d, fstest.MapFS{"sql/001_init.sql": &fstest.MapFile{Data: b}}); err != nil {
		t.Fatal(err)
	}
	_, err = d.Exec(`INSERT INTO nodes(id,created_at,updated_at) VALUES ('node','now','now');
INSERT INTO services(name,node_id,fleet_json,desired_state,expose_mode,hostname,container_port,host_port,created_at,updated_at)
VALUES ('app','node','{}','running',?,'app.example.com',8080,20001,'now','now');
INSERT INTO releases(id,service,image,created_at) VALUES ('release','app','image','now');
INSERT INTO instances(service,node_id,release_id,compose_project) VALUES ('app','node','release','fleet-app');`, mode)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestWebModesMigrationPreservesData(t *testing.T) {
	d := legacyDB(t, "access")
	if err := Migrate(d, SQLFiles); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(d, SQLFiles); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"services", "releases", "instances"} {
		var count int
		if err := d.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s: count=%d err=%v", table, count, err)
		}
	}
	if _, err := d.Exec(`SELECT cf_hostname_route_id FROM services`); err == nil {
		t.Fatal("obsolete route column remains")
	}
	if _, err := d.Exec(`UPDATE services SET expose_mode='private' WHERE name='app'`); err == nil {
		t.Fatal("retired mode accepted")
	}
	if _, err := d.Exec(`UPDATE services SET expose_mode='public' WHERE name='app'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := d.QueryRow(`SELECT count(*) FROM pragma_foreign_key_check`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("foreign key integrity: %d %v", count, err)
	}
}

func TestWebModesMigrationRejectsLegacyRowsWithoutConversion(t *testing.T) {
	d := legacyDB(t, "private")
	if err := Migrate(d, SQLFiles); err == nil {
		t.Fatal("unsupported stored mode must require operator migration")
	}
	var mode string
	if err := d.QueryRow(`SELECT expose_mode FROM services WHERE name='app'`).Scan(&mode); err != nil || mode != "private" {
		t.Fatalf("legacy data changed: %s %v", mode, err)
	}
	if _, err := d.Exec(`SELECT cf_hostname_route_id FROM services`); err != nil {
		t.Fatalf("failed migration not rolled back: %v", err)
	}
}
