package group

import (
	"errors"
	"fmt"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const (
	DefaultSessionTimeout   = 5 * time.Second
	DefaultRebalanceTimeout = 10 * time.Second
)

// HighWatermarkSource returns a quorum-confirmed committed high watermark
// for a data partition. Local LEO is not acceptable proof.
type HighWatermarkSource interface {
	HighWatermark(topic string, partition uint32) (uint64, error)
}

type CoordinatorConfig struct {
	State            Config
	SessionTimeout   time.Duration
	RebalanceTimeout time.Duration
}

// Coordinator drives the __mkfk_groups Raft partition. It is a single-owner
// actor: callers serialize all calls and pass the current time explicitly.
type Coordinator struct {
	node   *raft.Node
	state  *State
	config CoordinatorConfig

	pending map[uint64]proposal
	out     Output
	seq     uint64
	now     time.Time

	// Volatile, per leader term.
	serving         bool
	failoverStarted bool
	failover        map[uint64]bool
	lastSeen        map[memberKey]time.Time
	preparing       map[string]preparing
	timerProposed   map[string]uint64
	assignProposed  map[string]uint64
	syncProposed    map[memberKey]uint64
}

// preparing records when a group's current generation started rebalancing.
type preparing struct {
	generation uint64
	since      time.Time
}

func NewCoordinator(node *raft.Node, config CoordinatorConfig) (*Coordinator, error) {
	if node == nil {
		return nil, errors.New("Raft node is required")
	}
	if config.SessionTimeout == 0 {
		config.SessionTimeout = DefaultSessionTimeout
	}
	if config.RebalanceTimeout == 0 {
		config.RebalanceTimeout = DefaultRebalanceTimeout
	}
	state, err := NewState(config.State)
	if err != nil {
		return nil, err
	}
	if err := state.Replay(node.RecoveredApplied()); err != nil {
		return nil, err
	}
	coordinator := &Coordinator{node: node, state: state, config: config, pending: map[uint64]proposal{}}
	coordinator.resetTerm()
	return coordinator, nil
}

func (c *Coordinator) State() *State { return c.state }

// Serving reports whether this node leads the current term and has finished
// the failover rebalance, so it may answer group requests.
func (c *Coordinator) Serving() bool { return c.serving }

// HandleReady applies committed entries from a Raft Ready, settles proposals,
// and starts failover once this node is a ready leader.
func (c *Coordinator) HandleReady(ready raft.Ready, now time.Time) (Output, error) {
	c.now = now
	c.out.Messages = append(c.out.Messages, ready.Messages...)
	err := c.apply(ready)
	if err == nil {
		err = c.maybeStartFailover()
	}
	return c.take(), err
}

func (c *Coordinator) apply(ready raft.Ready) error {
	for _, change := range ready.RoleChanges {
		if change.To == raft.Leader {
			c.resetTerm()
		} else {
			c.loseLeadership()
		}
	}
	for _, frame := range ready.Applied {
		if err := c.applyFrame(frame); err != nil {
			return err
		}
	}
	return nil
}

func (c *Coordinator) applyFrame(frame storage.Frame) error {
	result, err := c.state.ApplyFrame(frame)
	if err != nil {
		return err
	}
	if prop, ok := c.pending[frame.LogIndex]; ok {
		delete(c.pending, frame.LogIndex)
		completion := Completion{Index: frame.LogIndex, RequestID: prop.requestID, Result: result}
		if prop.term != frame.Term {
			completion = Completion{Index: frame.LogIndex, RequestID: prop.requestID, Unknown: true}
		}
		c.out.Completions = append(c.out.Completions, completion)
	}
	if frame.Kind != storage.KindGroup {
		return nil
	}
	if c.failover[frame.LogIndex] {
		delete(c.failover, frame.LogIndex)
		if len(c.failover) == 0 {
			c.startServing()
		}
	}
	command, err := storage.InspectGroupFrame(frame)
	if err != nil {
		return err
	}
	return c.afterApply(command.GroupID, result)
}

// afterApply tracks rebalance timing and proposes SET_ASSIGNMENT once every
// member of the generation has synced.
func (c *Coordinator) afterApply(groupID string, result Result) error {
	if result.Err != nil || !c.serving {
		return nil
	}
	switch result.Phase {
	case PhasePreparing:
		if c.preparing[groupID].generation != result.Generation {
			c.preparing[groupID] = preparing{generation: result.Generation, since: c.now}
		}
	case PhaseAssigning:
		if c.assignProposed[groupID] == result.Generation {
			return nil
		}
		c.assignProposed[groupID] = result.Generation
		_, err := c.proposeInternal(storage.GroupCommand{
			Type: storage.GroupSetAssignment, GroupID: groupID, Generation: result.Generation,
		})
		return err
	default:
		delete(c.preparing, groupID)
	}
	return nil
}

// maybeStartFailover runs once per leader term after the Raft barrier (the
// leader's own entry committed): every group with members starts a new
// generation so sessions from the previous coordinator are not reused.
func (c *Coordinator) maybeStartFailover() error {
	snapshot := c.node.Snapshot()
	if snapshot.Role != raft.Leader || !snapshot.LeaderReady || c.failoverStarted {
		return nil
	}
	c.failoverStarted = true
	for _, groupID := range c.state.Groups() {
		view, _ := c.state.Group(groupID)
		if len(view.Members) == 0 {
			continue
		}
		index, err := c.proposeInternal(storage.GroupCommand{
			Type: storage.GroupBeginRebalance, GroupID: groupID,
			ExpectedGeneration: view.Generation, Generation: view.Generation + 1,
		})
		if err != nil {
			return err
		}
		if !c.isApplied(index) {
			c.failover[index] = true
		}
	}
	if len(c.failover) == 0 {
		c.startServing()
	}
	return nil
}

// startServing gives every member a full session from now: heartbeats seen
// by a previous coordinator are not carried across terms.
func (c *Coordinator) startServing() {
	c.serving = true
	for _, groupID := range c.state.Groups() {
		view, _ := c.state.Group(groupID)
		for _, member := range view.Members {
			c.lastSeen[memberKey{groupID, member}] = c.now
		}
		if view.Phase == PhasePreparing {
			c.preparing[groupID] = preparing{generation: view.Generation, since: c.now}
		}
	}
}

func (c *Coordinator) loseLeadership() {
	for index, prop := range c.pending {
		c.out.Completions = append(c.out.Completions, Completion{Index: index, RequestID: prop.requestID, Unknown: true})
	}
	c.pending = map[uint64]proposal{}
	c.resetTerm()
}

func (c *Coordinator) resetTerm() {
	c.serving, c.failoverStarted = false, false
	c.failover = map[uint64]bool{}
	c.lastSeen = map[memberKey]time.Time{}
	c.preparing = map[string]preparing{}
	c.timerProposed = map[string]uint64{}
	c.assignProposed = map[string]uint64{}
	c.syncProposed = map[memberKey]uint64{}
}

// propose appends a client command; its completion arrives through Output.
func (c *Coordinator) propose(command storage.GroupCommand) (Ticket, error) {
	index, err := c.proposeEntry(command, command.RequestID)
	return Ticket{Index: index, RequestID: command.RequestID}, err
}

// proposeInternal appends a coordinator-issued command with a generated request_id.
func (c *Coordinator) proposeInternal(command storage.GroupCommand) (uint64, error) {
	if command.Type != storage.GroupSyncReady {
		c.seq++
		command.RequestID = fmt.Sprintf("coord-%d-%d", c.node.Snapshot().Term, c.seq)
	}
	return c.proposeEntry(command, "")
}

func (c *Coordinator) proposeEntry(command storage.GroupCommand, requestID string) (uint64, error) {
	snapshot := c.node.Snapshot()
	frame, err := storage.NewGroupFrame(snapshot.LastLogIndex+1, snapshot.Term, command)
	if err != nil {
		return 0, err
	}
	index, ready, err := c.node.ProposeFrame(storage.KindGroup, frame.Payload)
	if err != nil {
		return 0, err
	}
	if requestID != "" {
		c.pending[index] = proposal{term: snapshot.Term, requestID: requestID}
	}
	c.out.Messages = append(c.out.Messages, ready.Messages...)
	return index, c.apply(ready)
}

func (c *Coordinator) isApplied(index uint64) bool {
	return index <= c.node.Snapshot().LastApplied
}

func (c *Coordinator) take() Output {
	out := c.out
	c.out = Output{}
	return out
}
