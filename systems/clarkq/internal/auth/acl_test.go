package auth

import "testing"

func TestAllowQueueScopes(t *testing.T) {
	c := &Claims{Scope: "queue:orders:write queue:jobs:read"}
	if !AllowQueue(c, "admin", "orders", ActionWrite) {
		t.Fatal("expected write orders")
	}
	if AllowQueue(c, "admin", "orders", ActionRead) {
		t.Fatal("did not grant read orders")
	}
	if !AllowQueue(c, "admin", "jobs", ActionRead) {
		t.Fatal("expected read jobs")
	}
	if AllowQueue(c, "admin", "jobs", ActionWrite) {
		t.Fatal("did not grant write jobs")
	}
}

func TestAllowQueueWildcardAndAdmin(t *testing.T) {
	c := &Claims{Scope: "queue:*:read"}
	if !AllowQueue(c, "", "any", ActionRead) {
		t.Fatal("wildcard read")
	}
	if AllowQueue(c, "", "any", ActionWrite) {
		t.Fatal("no write")
	}

	admin := &Claims{Roles: []string{"admin"}}
	if !AllowQueue(admin, "admin", "x", ActionAdmin) {
		t.Fatal("role admin")
	}

	star := &Claims{Scopes: []string{"queue:orders:*"}}
	if !AllowQueue(star, "", "orders", ActionAdmin) {
		t.Fatal("queue action star")
	}
}

func TestAllowQueueNilClaims(t *testing.T) {
	if !AllowQueue(nil, "admin", "q", ActionWrite) {
		t.Fatal("nil claims should allow (API key path)")
	}
}
