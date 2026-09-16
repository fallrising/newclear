package protocol

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
)

const (
	MaxRawRecordBytes  = 1 << 20
	MaxRecordsPerBatch = 1000
)

type Record struct {
	Key   []byte
	Value []byte
}

// A nil Key is distinct from a non-nil empty Key.
func (r Record) Validate() error {
	if len(r.Key) > math.MaxInt32 {
		return errors.New("record key exceeds int32")
	}
	if len(r.Value) > math.MaxUint32 {
		return errors.New("record value exceeds uint32")
	}
	if len(r.Key) > MaxRawRecordBytes-len(r.Value) {
		return fmt.Errorf("record exceeds %d raw bytes", MaxRawRecordBytes)
	}
	return nil
}

func BatchFingerprint(records []Record) ([sha256.Size]byte, error) {
	if len(records) == 0 || len(records) > MaxRecordsPerBatch {
		return [sha256.Size]byte{}, fmt.Errorf("batch must contain 1..%d records", MaxRecordsPerBatch)
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte("mkfk-batch-v1\x00"))
	var scratch [4]byte
	binary.BigEndian.PutUint32(scratch[:], uint32(len(records)))
	_, _ = hash.Write(scratch[:])
	for _, record := range records {
		if err := record.Validate(); err != nil {
			return [sha256.Size]byte{}, err
		}
		if record.Key == nil {
			binary.BigEndian.PutUint32(scratch[:], math.MaxUint32)
		} else {
			binary.BigEndian.PutUint32(scratch[:], uint32(len(record.Key)))
		}
		_, _ = hash.Write(scratch[:])
		_, _ = hash.Write(record.Key)
		binary.BigEndian.PutUint32(scratch[:], uint32(len(record.Value)))
		_, _ = hash.Write(scratch[:])
		_, _ = hash.Write(record.Value)
	}
	var result [sha256.Size]byte
	copy(result[:], hash.Sum(nil))
	return result, nil
}

func PartitionForKey(key []byte, partitionCount uint32) (uint32, error) {
	if partitionCount == 0 {
		return 0, errors.New("partition count must be positive")
	}
	hash := fnv.New64a()
	_, _ = hash.Write(key)
	return uint32(hash.Sum64() % uint64(partitionCount)), nil
}
