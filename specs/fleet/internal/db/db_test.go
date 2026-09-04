package db

import "testing"

func TestMigrate(t *testing.T) {
	sqldb, err := OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	if err := Ping(sqldb); err != nil {
		t.Fatal(err)
	}
	var name string
	if err := sqldb.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='tombstones'`).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(sqldb, SQLFiles); err != nil {
		t.Fatal(err)
	}
}
