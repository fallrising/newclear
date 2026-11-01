package replication

// Operation and gate history lets a retry find its original entry and
// result. Both maps are caches: an evicted operation is rebuilt from the
// WAL by AwaitExistingData, and gate request IDs are never reused. A full
// history therefore evicts its oldest completed entries; only entries that
// are still pending count against the cap.

// roomForOperation evicts completed operations until one more fits.
func (controller *Controller) roomForOperation() bool {
	for len(controller.operations) >= controller.config.MaxOperationHistory {
		if !controller.evictOldest(&controller.operationOrder, func(id string) bool {
			operation := controller.operations[id]
			if operation == nil {
				return true
			}
			if operation.pendingGate != "" {
				return false
			}
			delete(controller.operations, id)
			return true
		}) {
			return false
		}
	}
	return true
}

// roomForGate evicts completed gates until one more fits.
func (controller *Controller) roomForGate() bool {
	for len(controller.gates) >= controller.config.MaxGateHistory {
		if !controller.evictOldest(&controller.gateOrder, func(id string) bool {
			gate := controller.gates[id]
			if gate == nil {
				return true
			}
			if gate.result.Status == GatePending {
				return false
			}
			delete(controller.gates, id)
			return true
		}) {
			return false
		}
	}
	return true
}

// evictOldest removes the first entry of order that evict accepts.
func (controller *Controller) evictOldest(order *[]string, evict func(string) bool) bool {
	for index, id := range *order {
		if evict(id) {
			*order = append((*order)[:index], (*order)[index+1:]...)
			return true
		}
	}
	return false
}
