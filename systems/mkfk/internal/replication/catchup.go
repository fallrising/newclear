package replication

import (
	"sort"
	"time"
)

const maxAppendMarks = 4096

// appendMark records when the leader's log first reached index.
type appendMark struct {
	index uint64
	at    time.Time
}

// markAppended records the leader's last index at now whenever it grows.
func (controller *Controller) markAppended(last uint64, now time.Time) {
	if count := len(controller.marks); count > 0 && controller.marks[count-1].index >= last {
		return
	}
	controller.marks = append(controller.marks, appendMark{index: last, at: now})
	if len(controller.marks) > maxAppendMarks {
		controller.marksFloor = controller.marks[0].index
		controller.marks = controller.marks[1:]
	}
}

// caughtUpAsOf returns the latest time at which a follower holding the log
// through matched had everything the leader had: the moment the leader
// appended matched+1. A follower one round trip behind a busy leader is
// thereby caught up as of a moment ago, while one stuck below a moving
// leader keeps an old time. Zero means unknown.
func (controller *Controller) caughtUpAsOf(matched uint64) time.Time {
	if matched < controller.marksFloor {
		return time.Time{}
	}
	index := sort.Search(len(controller.marks), func(i int) bool { return controller.marks[i].index > matched })
	if index == len(controller.marks) {
		return time.Time{}
	}
	return controller.marks[index].at
}

// pruneMarks drops marks that every in-sync follower has passed.
func (controller *Controller) pruneMarks() {
	floor, found := uint64(0), false
	for peer, observation := range controller.peers {
		if !observation.InSync {
			continue
		}
		if match := controller.durableMatch[peer]; !found || match < floor {
			floor, found = match, true
		}
	}
	if !found {
		return
	}
	drop := sort.Search(len(controller.marks), func(i int) bool { return controller.marks[i].index > floor })
	controller.marks = controller.marks[drop:]
}
