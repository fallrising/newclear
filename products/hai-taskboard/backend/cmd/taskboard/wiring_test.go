package main

import "testing"

func TestComposition_RejectsIncompleteConcreteDependencies(t *testing.T) {
	t.Parallel()
	if _, err := Compose(Dependencies{}); err == nil {
		t.Fatal("Compose accepted an incomplete concrete composition")
	}
}
