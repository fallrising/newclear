package fake

import (
	"slices"
	"testing"
)

func TestFakeAdapter_DeclaresRegisteredScenariosWithoutAliases(t *testing.T) {
	alpha := mustScenario(t, "alpha", nil, []Step{{Tick: 0, Kind: ObservationDispatchReceived}})
	zeta := mustScenario(t, "zeta", nil, []Step{{Tick: 0, Kind: ObservationDispatchReceived}})
	adapter, err := NewAdapter(nil, []Scenario{zeta, alpha}, nil)
	if err != nil {
		t.Fatal(err)
	}
	declaration := adapter.Declaration()
	if !slices.Equal(declaration.Scenarios, []string{"alpha", "zeta"}) {
		t.Fatalf("registered scenarios = %v", declaration.Scenarios)
	}
	clone := declaration.Clone()
	clone.Scenarios[0] = "unregistered"
	declaration.Scenarios[1] = "unregistered"
	if !slices.Equal(adapter.Declaration().Scenarios, []string{"alpha", "zeta"}) {
		t.Fatal("scenario declaration retained a caller alias")
	}
}
