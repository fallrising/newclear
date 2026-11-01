package group

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/testkit"
)

// groupModel drives one seeded schedule of client commands, session
// timeouts, HW growth and coordinator failovers on an RF3 groups partition.
type groupModel struct {
	*groupCluster
	t           *testing.T
	seed        int64
	random      *rand.Rand
	leader      uint32
	isolated    uint32
	history     []string
	commits     map[Ticket]uint64 // commit ticket -> generation it named
	staleTerm   map[Ticket]bool   // proposed on a deposed, isolated coordinator
	generations map[uint32]uint64
	offsets     map[TopicPartition]uint64
	checked     map[uint32]int
}

func TestM6GroupModel100Seeds300Events(t *testing.T) {
	t.Parallel()
	modelSeeds, modelEvents := testkit.ModelProfile(100, 300)
	for seed := int64(0); seed < int64(modelSeeds); seed++ {
		seed := seed
		t.Run(fmt.Sprintf("seed-%03d", seed), func(t *testing.T) {
			t.Parallel()
			model := &groupModel{
				groupCluster: newGroupCluster(t, 3), t: t, seed: seed, random: rand.New(rand.NewSource(seed)),
				commits: map[Ticket]uint64{}, staleTerm: map[Ticket]bool{}, generations: map[uint32]uint64{},
				offsets: map[TopicPartition]uint64{}, checked: map[uint32]int{},
			}
			model.leader = 1
			model.elect(t, 1)
			for event := 0; event < modelEvents; event++ {
				model.step()
				model.check(event)
			}
			t.Log(model.summary())
		})
	}
}

func (m *groupModel) record(format string, args ...any) {
	m.history = append(m.history, fmt.Sprintf(format, args...))
}

func (m *groupModel) step() {
	coordinator := m.coords[m.leader]
	view, _ := coordinator.State().Group("g")
	member := fmt.Sprintf("m%d", 1+m.random.Intn(5))
	switch event := m.random.Intn(20); {
	case event < 2:
		m.record("join %s", member)
		_, out, err := coordinator.Join("g", protocol.JoinGroupRequest{MemberID: member, Subscription: []string{"events"}, RequestID: m.requestID()}, m.now)
		m.handle(m.t, m.leader, out, err)
	case event == 2:
		m.record("leave %s gen=%d", member, view.Generation)
		_, out, err := coordinator.Leave("g", protocol.LeaveGroupRequest{MemberID: member, Generation: protocol.DecimalUint64(view.Generation), RequestID: m.requestID()}, m.now)
		m.handle(m.t, m.leader, out, err)
	case event < 7:
		m.record("sync all gen=%d", view.Generation)
		for _, id := range view.Members {
			_, out, _ := coordinator.Sync("g", protocol.SyncGroupRequest{MemberID: id, Generation: protocol.DecimalUint64(view.Generation), Revoked: true}, m.now)
			m.handle(m.t, m.leader, out, nil)
		}
	case event < 13:
		m.commit(m.leader, member, view.Generation)
	case event < 16:
		m.now = m.now.Add(time.Duration(1+m.random.Intn(3)) * time.Second)
		m.record("tick to %s", m.now.Format("15:04:05"))
		for _, id := range view.Members {
			if m.random.Intn(4) > 0 {
				m.heartbeatMember(m.t, m.leader, "g", id, view.Generation)
			}
		}
		out, err := coordinator.CheckTimers(m.now)
		m.handle(m.t, m.leader, out, err)
	case event < 19:
		partition := TopicPartition{Topic: "events", Partition: uint32(m.random.Intn(3))}
		m.hw[partition] += uint64(m.random.Intn(4))
		m.record("hw %v=%d", partition, m.hw[partition])
	default:
		m.failover(member, view.Generation)
	}
	m.drain(m.t)
}

// commit usually comes from a partition's owner in the current generation;
// sometimes it names the previous generation, a non-owner or a non-member.
func (m *groupModel) commit(node uint32, member string, generation uint64) Ticket {
	if generation > 0 && m.random.Intn(4) == 0 {
		generation--
	}
	partition := uint32(m.random.Intn(3))
	view, _ := m.coords[node].State().Group("g")
	if len(view.Members) > 0 && m.random.Intn(4) > 0 {
		member = view.Members[m.random.Intn(len(view.Members))]
		if assigned, _ := m.coords[node].State().Assignment("g", member); len(assigned) > 0 {
			partition = assigned[m.random.Intn(len(assigned))].Partition
		}
	}
	offset := uint64(m.random.Intn(int(m.hw[TopicPartition{Topic: "events", Partition: partition}]) + 2))
	m.record("commit node=%d %s gen=%d events/%d=%d", node, member, generation, partition, offset)
	ticket, out, err := m.coords[node].CommitOffsets("g", protocol.CommitOffsetsRequest{
		MemberID: member, Generation: protocol.DecimalUint64(generation), RequestID: m.requestID(),
		Offsets: []protocol.OffsetCommit{{Topic: "events", Partition: partition, Offset: protocol.DecimalUint64(offset)}},
	}, m.hw, m.now)
	m.handle(m.t, node, out, nil)
	if err == nil {
		m.commits[ticket] = generation
	}
	return ticket
}

// failover isolates the coordinator, lets it accept one commit it can never
// replicate, elects another node, then heals the partition.
func (m *groupModel) failover(member string, generation uint64) {
	old := m.leader
	m.isolate(old)
	m.staleTerm[m.commit(old, member, generation)] = true
	m.leader = old%3 + 1
	m.record("failover %d -> %d", old, m.leader)
	m.elect(m.t, m.leader)
	m.heal()
	m.heartbeat(m.t, m.leader)
}

// summary counts commit outcomes so a run shows what the schedule exercised.
func (m *groupModel) summary() string {
	counts := map[string]int{}
	for _, completions := range m.completions {
		for _, completion := range completions {
			if _, isCommit := m.commits[Ticket{Index: completion.Index, RequestID: completion.RequestID}]; !isCommit {
				continue
			}
			switch {
			case completion.Unknown:
				counts["unknown"]++
			case completion.Result.Err == nil:
				counts["committed"]++
			case IsCode(completion.Result.Err, CodeIllegalGeneration):
				counts["illegal_generation"]++
			default:
				counts["other_rejection"]++
			}
		}
	}
	view, _ := m.coords[m.leader].State().Group("g")
	return fmt.Sprintf("commits committed=%d illegal_generation=%d other_rejection=%d unknown=%d failovers=%d final_generation=%d",
		counts["committed"], counts["illegal_generation"], counts["other_rejection"], counts["unknown"], len(m.staleTerm), view.Generation)
}

func (m *groupModel) requestID() string {
	return fmt.Sprintf("r%d", len(m.history))
}

func (m *groupModel) fail(event int, format string, args ...any) {
	m.t.Helper()
	tail := m.history
	if len(tail) > 25 {
		tail = tail[len(tail)-25:]
	}
	m.t.Fatalf("seed=%d event=%d: %s\nhistory:\n  %s", m.seed, event, fmt.Sprintf(format, args...), strings.Join(tail, "\n  "))
}

func (m *groupModel) check(event int) {
	m.t.Helper()
	for id, coordinator := range m.coords {
		view, _ := coordinator.State().Group("g")
		if view.Generation < m.generations[id] {
			m.fail(event, "node %d generation went back from %d to %d", id, m.generations[id], view.Generation)
		}
		m.generations[id] = view.Generation
		for _, completion := range m.completions[id][m.checked[id]:] {
			generation, isCommit := m.commits[Ticket{Index: completion.Index, RequestID: completion.RequestID}]
			if !isCommit || completion.Unknown || completion.Result.Err != nil {
				continue
			}
			if m.staleTerm[Ticket{Index: completion.Index, RequestID: completion.RequestID}] {
				m.fail(event, "commit proposed by a deposed coordinator succeeded: %+v", completion)
			}
			if completion.Result.Generation != generation {
				m.fail(event, "commit for generation %d succeeded in generation %d", generation, completion.Result.Generation)
			}
		}
		m.checked[id] = len(m.completions[id])
	}
	leader := m.coords[m.leader].State()
	for partition := uint32(0); partition < 3; partition++ {
		key := TopicPartition{Topic: "events", Partition: partition}
		offset, _ := leader.CommittedOffset("g", key)
		if offset < m.offsets[key] || offset > m.hw[key] {
			m.fail(event, "%v committed %d after %d with HW %d", key, offset, m.offsets[key], m.hw[key])
		}
		m.offsets[key] = offset
	}
	m.checkAssignment(event, leader)
}

// checkAssignment requires a STABLE group to own every partition exactly once.
func (m *groupModel) checkAssignment(event int, state *State) {
	view, exists := state.Group("g")
	if !exists || view.Phase != PhaseStable {
		return
	}
	owners := map[TopicPartition]int{}
	for _, member := range view.Members {
		assigned, _ := state.Assignment("g", member)
		for _, partition := range assigned {
			owners[partition]++
		}
	}
	if len(owners) != 3 {
		m.fail(event, "STABLE generation %d assigns %d of 3 partitions", view.Generation, len(owners))
	}
	for partition, count := range owners {
		if count != 1 {
			m.fail(event, "%v has %d owners", partition, count)
		}
	}
}
