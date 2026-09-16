package raft

import (
	"errors"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

func (node *Node) stepRequestVote(message Message) (Ready, error) {
	response := node.response(MessageRequestVoteResponse, message)
	response.VoteResp = &RequestVoteResponse{}
	if message.Term < node.term {
		return Ready{Messages: []Message{response}, LeaderReady: node.leaderReady}, nil
	}
	lastIndex := node.log.LastLogIndex()
	lastTerm, err := node.termAt(lastIndex)
	if err != nil {
		return Ready{}, err
	}
	request := message.Vote
	upToDate := request.LastLogTerm > lastTerm || request.LastLogTerm == lastTerm && request.LastLogIndex >= lastIndex
	canVote := node.votedFor == nil || *node.votedFor == message.From
	if canVote && upToDate {
		if node.votedFor == nil {
			candidate := message.From
			state := storage.HardState{CurrentTerm: node.term, VotedFor: &candidate, CommitIndex: node.commitIndex}
			if err := node.log.PersistHardState(state); err != nil {
				return Ready{}, fmt.Errorf("persist granted vote: %w", err)
			}
			node.votedFor = &candidate
		}
		node.electionElapsed = 0
		response.VoteResp.Granted = true
	}
	response.Term = node.term
	return Ready{Messages: []Message{response}, LeaderReady: node.leaderReady}, nil
}

func (node *Node) stepVoteResponse(message Message) (Ready, error) {
	if message.Term < node.term || node.role != Candidate {
		return Ready{LeaderReady: node.leaderReady}, nil
	}
	if message.Term != node.term {
		return Ready{}, errors.New("vote response term was not normalized")
	}
	if _, seen := node.votes[message.From]; seen {
		return Ready{LeaderReady: node.leaderReady}, nil
	}
	node.votes[message.From] = message.VoteResp.Granted
	granted := 0
	rejected := 0
	for _, vote := range node.votes {
		if vote {
			granted++
		} else {
			rejected++
		}
	}
	if granted >= node.quorum() {
		return node.becomeLeader()
	}
	if rejected >= node.quorum() {
		change, err := node.becomeFollower(node.term, 0)
		if err != nil {
			return Ready{}, err
		}
		ready := Ready{LeaderReady: false}
		if change != nil {
			ready.RoleChanges = append(ready.RoleChanges, *change)
		}
		return ready, nil
	}
	return Ready{LeaderReady: false}, nil
}

func (node *Node) stepAppendEntries(message Message) (Ready, error) {
	response := node.response(MessageAppendResponse, message)
	response.AppendResp = &AppendResponse{ConflictIndex: node.log.LastLogIndex() + 1}
	if message.Term < node.term {
		return Ready{Messages: []Message{response}, LeaderReady: node.leaderReady}, nil
	}
	ready := Ready{LeaderReady: false}
	if node.role != Follower || node.leaderID != message.From {
		change, err := node.becomeFollower(node.term, message.From)
		if err != nil {
			return Ready{}, err
		}
		if change != nil {
			ready.RoleChanges = append(ready.RoleChanges, *change)
		}
	}
	node.leaderID = message.From
	node.electionElapsed = 0
	request := message.Append
	if len(request.Entries) > MaxAppendEntries {
		return Ready{}, fmt.Errorf("AppendEntries count exceeds %d", MaxAppendEntries)
	}
	encodedBytes := 0
	for _, entry := range request.Entries {
		if entry.Term > message.Term {
			return Ready{}, fmt.Errorf("entry term %d exceeds leader term %d", entry.Term, message.Term)
		}
		encoded, err := storage.EncodeFrame(entry)
		if err != nil {
			return Ready{}, err
		}
		encodedBytes += len(encoded)
		if encodedBytes > MaxAppendBytes {
			return Ready{}, fmt.Errorf("AppendEntries bytes exceed %d", MaxAppendBytes)
		}
	}
	lastIndex := node.log.LastLogIndex()
	if request.PrevLogIndex > lastIndex {
		response.AppendResp.ConflictIndex = lastIndex + 1
		ready.Messages = append(ready.Messages, response)
		return ready, nil
	}
	if request.PrevLogIndex > 0 {
		localTerm, err := node.log.Term(request.PrevLogIndex)
		if err != nil {
			return Ready{}, err
		}
		if localTerm != request.PrevLogTerm {
			conflict := request.PrevLogIndex
			for conflict > 1 {
				previousTerm, err := node.log.Term(conflict - 1)
				if err != nil || previousTerm != localTerm {
					break
				}
				conflict--
			}
			response.AppendResp.ConflictIndex = conflict
			ready.Messages = append(ready.Messages, response)
			return ready, nil
		}
	}

	expected := request.PrevLogIndex + 1
	appendFrom := len(request.Entries)
	lastIndex = node.log.LastLogIndex()
	for index, incoming := range request.Entries {
		if incoming.LogIndex != expected {
			return Ready{}, fmt.Errorf("AppendEntries index %d does not follow %d", incoming.LogIndex, expected-1)
		}
		if incoming.LogIndex <= lastIndex {
			localTerm, err := node.log.Term(incoming.LogIndex)
			if err != nil {
				return Ready{}, err
			}
			if localTerm == incoming.Term {
				local, err := node.readOne(incoming.LogIndex)
				if err != nil {
					return Ready{}, err
				}
				if !frameEqual(local, incoming) {
					return Ready{}, fmt.Errorf("same index/term has different content at %d", incoming.LogIndex)
				}
				expected++
				continue
			}
			if incoming.LogIndex <= node.commitIndex {
				return Ready{}, fmt.Errorf("conflict at committed index %d", incoming.LogIndex)
			}
			if err := node.log.TruncateSuffix(incoming.LogIndex); err != nil {
				return Ready{}, err
			}
			appendFrom = index
			break
		}
		appendFrom = index
		break
	}
	if appendFrom < len(request.Entries) {
		if err := node.log.AppendEntries(cloneFrames(request.Entries[appendFrom:])); err != nil {
			return Ready{}, err
		}
	}
	matched := request.PrevLogIndex + uint64(len(request.Entries))
	response.AppendResp.Success = true
	response.AppendResp.MatchedIndex = matched
	response.AppendResp.ConflictIndex = 0
	response.AppendResp.ReadContext = request.ReadContext
	verifiedCommit := request.LeaderCommit
	if verifiedCommit > matched {
		verifiedCommit = matched
	}
	if verifiedCommit > node.commitIndex {
		state := storage.HardState{CurrentTerm: node.term, VotedFor: cloneVote(node.votedFor), CommitIndex: verifiedCommit}
		if err := node.log.PersistHardState(state); err != nil {
			return Ready{}, fmt.Errorf("persist follower commit: %w", err)
		}
		node.commitIndex = verifiedCommit
		applied, err := node.applyThrough(verifiedCommit)
		if err != nil {
			return Ready{}, err
		}
		ready.Applied = append(ready.Applied, applied...)
	}
	response.Term = node.term
	ready.Messages = append(ready.Messages, response)
	return ready, nil
}

func (node *Node) stepAppendResponse(message Message) (Ready, error) {
	if message.Term < node.term || node.role != Leader {
		return Ready{LeaderReady: node.leaderReady}, nil
	}
	if message.Term != node.term {
		return Ready{}, errors.New("append response term was not normalized")
	}
	progress, exists := node.progress[message.From]
	if !exists {
		return Ready{}, errors.New("append response came from an untracked peer")
	}
	sent, exists := node.sent[message.RPCID]
	if !exists || sent.peer != message.From || sent.term != node.term {
		return Ready{LeaderReady: node.leaderReady}, nil
	}
	delete(node.sent, message.RPCID)
	response := message.AppendResp
	ready := Ready{LeaderReady: node.leaderReady}
	if !response.Success {
		if message.RPCID == progress.latestRPC && response.ConflictIndex > 0 && response.ConflictIndex < progress.nextIndex {
			progress.nextIndex = response.ConflictIndex
		}
		appendMessage, err := node.makeAppend(message.From, sent.readContext)
		if err != nil {
			return Ready{}, err
		}
		ready.Messages = append(ready.Messages, appendMessage)
		return ready, nil
	}
	matched := response.MatchedIndex
	if matched < sent.prevIndex {
		return Ready{}, errors.New("append response match precedes the verified prev index")
	}
	if matched > sent.lastIndex {
		return Ready{}, errors.New("append response claims an unsent match index")
	}
	if matched >= sent.prevIndex && matched > progress.matchIndex {
		progress.matchIndex = matched
		progress.nextIndex = matched + 1
	}
	ready.DurableAcks = append(ready.DurableAcks, DurableAck{
		PeerID: message.From, Term: node.term, MatchIndex: matched, RPCID: message.RPCID,
	})
	applied, err := node.advanceCommit()
	if err != nil {
		return Ready{}, err
	}
	ready.Applied = append(ready.Applied, applied...)
	if sent.readContext != "" && response.ReadContext == sent.readContext && matched >= sent.readIndex {
		if pending, ok := node.pendingReads[sent.readContext]; ok && pending.index == sent.readIndex {
			pending.acks[message.From] = struct{}{}
			if len(pending.acks) >= node.quorum() && node.lastApplied >= pending.index {
				ready.ReadStates = append(ready.ReadStates, ReadState{Context: sent.readContext, Index: pending.index})
				delete(node.pendingReads, sent.readContext)
			}
		}
	}
	if progress.nextIndex <= node.log.LastLogIndex() {
		context := ""
		if sent.readContext != "" && matched < sent.readIndex {
			context = sent.readContext
		}
		appendMessage, err := node.makeAppend(message.From, context)
		if err != nil {
			return Ready{}, err
		}
		ready.Messages = append(ready.Messages, appendMessage)
	}
	ready.LeaderReady = node.leaderReady
	return ready, nil
}

func (node *Node) broadcastAppend(readContext string) ([]Message, error) {
	messages := make([]Message, 0, len(node.progress))
	for _, voter := range node.config.Voters {
		if voter == node.config.NodeID {
			continue
		}
		message, err := node.makeAppend(voter, readContext)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, nil
}

func (node *Node) makeAppend(peer uint32, readContext string) (Message, error) {
	progress := node.progress[peer]
	if progress == nil {
		return Message{}, errors.New("peer progress is missing")
	}
	lastIndex := node.log.LastLogIndex()
	if progress.nextIndex == 0 || progress.nextIndex > lastIndex+1 {
		progress.nextIndex = lastIndex + 1
	}
	prevIndex := progress.nextIndex - 1
	prevTerm, err := node.termAt(prevIndex)
	if err != nil {
		return Message{}, err
	}
	entries := []storage.Frame(nil)
	if progress.nextIndex <= lastIndex {
		entries, err = node.log.ReadEntries(progress.nextIndex, MaxAppendBytes)
		if err != nil {
			return Message{}, err
		}
		if len(entries) > MaxAppendEntries {
			entries = entries[:MaxAppendEntries]
		}
	}
	rpcID := node.nextRPCID()
	sentLast := prevIndex
	if len(entries) > 0 {
		sentLast = entries[len(entries)-1].LogIndex
	}
	readIndex := uint64(0)
	if readContext != "" {
		if pending := node.pendingReads[readContext]; pending != nil {
			readIndex = pending.index
		}
	}
	node.sent[rpcID] = sentAppend{
		peer: peer, term: node.term, prevIndex: prevIndex, lastIndex: sentLast,
		readContext: readContext, readIndex: readIndex,
	}
	progress.latestRPC = rpcID
	return Message{
		Kind:     MessageAppendEntries,
		Identity: node.config.Identity,
		From:     node.config.NodeID,
		To:       peer,
		Term:     node.term,
		RPCID:    rpcID,
		Append: &AppendEntries{
			PrevLogIndex: prevIndex,
			PrevLogTerm:  prevTerm,
			Entries:      cloneFrames(entries),
			LeaderCommit: node.commitIndex,
			ReadContext:  readContext,
		},
	}, nil
}

func (node *Node) advanceCommit() ([]storage.Frame, error) {
	if node.role != Leader {
		return nil, nil
	}
	lastIndex := node.log.LastLogIndex()
	for candidate := lastIndex; candidate > node.commitIndex; candidate-- {
		term, err := node.log.Term(candidate)
		if err != nil {
			return nil, err
		}
		if term != node.term {
			continue
		}
		matches := 1 // The leader appends synchronously before reaching here.
		for _, progress := range node.progress {
			if progress.matchIndex >= candidate {
				matches++
			}
		}
		if matches < node.quorum() {
			continue
		}
		state := storage.HardState{CurrentTerm: node.term, VotedFor: cloneVote(node.votedFor), CommitIndex: candidate}
		if err := node.log.PersistHardState(state); err != nil {
			return nil, fmt.Errorf("persist leader commit: %w", err)
		}
		node.commitIndex = candidate
		return node.applyThrough(candidate)
	}
	return nil, nil
}

func (node *Node) applyThrough(index uint64) ([]storage.Frame, error) {
	if index <= node.lastApplied {
		return nil, nil
	}
	entries, err := node.readRange(node.lastApplied+1, index)
	if err != nil {
		return nil, err
	}
	node.lastApplied = index
	if node.role == Leader && node.noopIndex > 0 && node.lastApplied >= node.noopIndex {
		node.leaderReady = true
	}
	return entries, nil
}
