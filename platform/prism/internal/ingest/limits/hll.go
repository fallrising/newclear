package limits

import (
	"math"
	"math/bits"
)

const hllPrecision = 14
const hllRegisters = 1 << hllPrecision
const hllRanks = 65 - hllPrecision

// hll has a fixed 16KiB register array plus a fixed 3.25MiB rank-frequency
// table. Counts cannot exceed the bounded number of active exact identities.
// Removing one hash retains ranks belonging to other colliding identities.
type hll struct {
	registers   [hllRegisters]uint8
	frequencies [hllRegisters][hllRanks + 1]uint32
}

func hllLocation(hash uint64) (int, uint8) {
	// Avalanche even structured caller fingerprints before splitting bits.
	hash ^= hash >> 30
	hash *= 0xbf58476d1ce4e5b9
	hash ^= hash >> 27
	hash *= 0x94d049bb133111eb
	hash ^= hash >> 31
	index := int(hash >> (64 - hllPrecision))
	rank := bits.LeadingZeros64((hash<<hllPrecision)|(1<<(hllPrecision-1))) + 1
	if rank < 1 || rank > hllRanks {
		return index, 1
	}
	return index, uint8(rank)
}
func (h *hll) add(hash uint64) {
	index, rank := hllLocation(hash)
	h.frequencies[index][rank]++
	if rank > h.registers[index] {
		h.registers[index] = rank
	}
}
func (h *hll) remove(hash uint64) {
	index, rank := hllLocation(hash)
	if h.frequencies[index][rank] == 0 {
		return
	}
	h.frequencies[index][rank]--
	if rank == h.registers[index] && h.frequencies[index][rank] == 0 {
		for rank > 0 && h.frequencies[index][rank] == 0 {
			rank--
		}
		h.registers[index] = rank
	}
}
func (h *hll) estimate() float64 {
	sum := 0.0
	zeros := 0
	for _, rank := range h.registers {
		sum += math.Ldexp(1, -int(rank))
		if rank == 0 {
			zeros++
		}
	}
	size := float64(hllRegisters)
	estimate := (0.7213 / (1 + 1.079/size)) * size * size / sum
	if estimate <= 2.5*size && zeros > 0 {
		estimate = size * math.Log(size/float64(zeros))
	}
	return estimate
}
