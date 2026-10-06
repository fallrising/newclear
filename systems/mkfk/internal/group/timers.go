package group

import (
	"sort"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// CheckTimers expires members whose session lapsed and, once a rebalance
// deadline passes, removes members that never synced. Each removal names the
// generation it was computed for, so a stale timer cannot remove a newer
// session. Timers only run while this node serves the current term.
func (c *Coordinator) CheckTimers(now time.Time) (Output, error) {
	c.now = now
	if !c.serving {
		return c.take(), c.maybeStartFailover()
	}
	for _, groupID := range c.state.Groups() {
		view, _ := c.state.Group(groupID)
		if len(view.Members) == 0 || c.timerProposed[groupID] == view.Generation {
			continue
		}
		expired := c.expiredMembers(groupID, view, now)
		if len(expired) == 0 {
			continue
		}
		c.timerProposed[groupID] = view.Generation
		if _, err := c.proposeInternal(storage.GroupCommand{
			Type: storage.GroupRemoveMembers, GroupID: groupID,
			MemberIDs: expired, ExpectedGeneration: view.Generation,
		}); err != nil {
			return c.take(), err
		}
	}
	return c.take(), nil
}

func (c *Coordinator) expiredMembers(groupID string, view View, now time.Time) []string {
	expired := map[string]bool{}
	for _, member := range view.Members {
		key := memberKey{groupID, member}
		seen, known := c.lastSeen[key]
		if !known {
			c.lastSeen[key] = now
			continue
		}
		if now.Sub(seen) > c.config.SessionTimeout {
			expired[member] = true
		}
	}
	if started := c.preparing[groupID]; view.Phase == PhasePreparing && started.generation == view.Generation &&
		now.Sub(started.since) > c.config.RebalanceTimeout {
		for _, member := range c.state.UnsyncedMembers(groupID) {
			expired[member] = true
		}
	}
	ids := make([]string, 0, len(expired))
	for member := range expired {
		ids = append(ids, member)
	}
	sort.Strings(ids)
	return ids
}
