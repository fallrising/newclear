package auth

import "strings"

// Queue actions for ACL checks.
const (
	ActionRead  = "read"  // GET consume / peek
	ActionWrite = "write" // POST enqueue
	ActionAdmin = "admin" // DELETE clear
	ActionList  = "list"  // GET /queues, metrics, crypto config
)

// AllowQueue reports whether claims permit action on queue.
// adminRole, when non-empty, grants full access if present in roles.
// When claims are nil (e.g. API key auth), returns true — caller decides.
func AllowQueue(claims *Claims, adminRole, queue, action string) bool {
	if claims == nil {
		return true
	}
	if adminRole != "" {
		for _, r := range claims.AllRoles() {
			if r == adminRole {
				return true
			}
		}
	}
	// "admin" scope is full access
	for _, p := range claims.Permissions() {
		if p == "admin" || p == "queue:*:*" {
			return true
		}
	}

	action = strings.ToLower(strings.TrimSpace(action))
	queue = strings.TrimSpace(queue)

	// list is not queue-scoped; require list/admin/* or any queue:*:read-ish
	if action == ActionList {
		for _, p := range claims.Permissions() {
			if p == "list" || p == "queue:list" || p == "queue:*:admin" || p == "queue:*:read" || p == "queue:*:write" {
				return true
			}
			if strings.HasPrefix(p, "queue:") {
				// any queue permission implies ability to list (filtered clients still get list)
				return true
			}
		}
		return false
	}

	for _, p := range claims.Permissions() {
		if matchQueuePerm(p, queue, action) {
			return true
		}
	}
	return false
}

func matchQueuePerm(perm, queue, action string) bool {
	// forms: queue:NAME:ACTION
	parts := strings.Split(perm, ":")
	if len(parts) != 3 || parts[0] != "queue" {
		return false
	}
	q, a := parts[1], parts[2]
	if q != "*" && q != queue {
		return false
	}
	if a == "*" || a == action {
		return true
	}
	// admin implies read+write+admin
	if a == ActionAdmin {
		return true
	}
	return false
}
