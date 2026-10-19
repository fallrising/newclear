package main

import (
	"strings"
	"testing"
	"time"
)

func TestSilentBrokerMatchesFinding4(t *testing.T) {
	t.Parallel()
	broker := judgeBroker("broker-2",
		sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 10},
		sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 10},
		0, 0)
	if !broker.Silent || verdictOf([]silentBroker{broker}) != "有" {
		t.Fatalf("finding 4 observation was not silent: %+v", broker)
	}
}

func TestLeaderOrFsyncOrLogLineIsNotSilent(t *testing.T) {
	t.Parallel()
	cases := []silentBroker{
		judgeBroker("leader", sample{eventsLeaderSeries: 1, "mkfk_fsync_total": 1}, sample{eventsLeaderSeries: 1, "mkfk_fsync_total": 1}, 0, 0),
		judgeBroker("became-leader", sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 1}, sample{eventsLeaderSeries: 1, "mkfk_fsync_total": 1}, 0, 0),
		judgeBroker("synced", sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 1}, sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 4}, 0, 0),
		judgeBroker("logged", sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 1}, sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 1}, 1, 0),
		judgeBroker("unparsed", sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 1}, sample{eventsLeaderSeries: 0, "mkfk_fsync_total": 1}, 0, 1),
		judgeBroker("unknown", sample{}, sample{}, 0, 0),
	}
	if verdictOf(cases) != "沒有" {
		t.Fatal("a non-matching broker was counted as silent")
	}
	for _, broker := range cases {
		if broker.Silent {
			t.Fatalf("%s was silent: %+v", broker.Broker, broker)
		}
	}
}

func TestCountWindowLinesUsesTheMeasurementWindow(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)
	end := start.Add(silentMeasure)
	logs := strings.Join([]string{
		"2026-10-19T14:59:50.000000000Z {\"msg\":\"broker ready\",\"client\":\"172.29.71.12:19092\"}",
		"broker-2  | 2026-10-19T15:00:01.000000000Z {\"msg\":\"slow fsync\"}",
		"2026-10-19T15:01:00.000000000Z {\"msg\":\"after the window\"}",
		"not a timestamp",
	}, "\n")
	inWindow, unparsed := countWindowLines(logs, start, end)
	if inWindow != 1 || unparsed != 1 {
		t.Fatalf("in window = %d, unparsed = %d", inWindow, unparsed)
	}
}

func TestScrubRemovesAddressesAndPaths(t *testing.T) {
	t.Parallel()
	scrubbed := scrubIdentifiers(`{"client":"172.29.71.11:19091","dir":"/var/lib/mkfk/node"}`)
	if strings.Contains(scrubbed, "172.29.71.11") || strings.Contains(scrubbed, "/var/lib/mkfk/node") {
		t.Fatalf("identifiers left in %s", scrubbed)
	}
	if !strings.Contains(scrubbed, "[ip]") || !strings.Contains(scrubbed, "[path]") {
		t.Fatalf("placeholders missing in %s", scrubbed)
	}
}
