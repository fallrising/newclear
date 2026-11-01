package partition

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// Fetch reads committed records in [offset, HW) after a current-term read
// barrier, so a deposed leader cannot serve a stale or uncommitted view.
func (d *Data) Fetch(ctx context.Context, request protocol.FetchRequest) (protocol.FetchResponseData, error) {
	var response protocol.FetchResponseData
	err := d.read(ctx, func(readContext string) error {
		records, next, hw, stats, err := d.controller.Fetch(readContext, uint64(request.Offset), int(request.MaxBytes))
		if err != nil {
			return err
		}
		d.fetches++
		d.fetchSeek += uint64(stats.SegmentComparisons + stats.IndexComparisons)
		d.fetchScanBytes += uint64(stats.ScannedBytes)
		response = protocol.FetchResponseData{
			Records: storageRecords(records), NextOffset: protocol.DecimalUint64(next),
			HighWatermark: protocol.DecimalUint64(hw), LogEndOffset: protocol.DecimalUint64(d.log.LEO()),
			LeaderTerm: protocol.DecimalUint64(d.node.Snapshot().Term),
		}
		return nil
	})
	return response, err
}

// HighWatermark is the proof a group coordinator needs before committing
// offsets: the HW this leader serves after a current-term majority confirmed
// its leadership. Local LEO, or a deposed leader's HW, never qualifies.
func (d *Data) HighWatermark(ctx context.Context) (uint64, error) {
	var hw uint64
	err := d.read(ctx, func(readContext string) error {
		var err error
		hw, err = d.controller.ConfirmedHighWatermark(readContext)
		return err
	})
	return hw, err
}

// LeaderHint returns the leader this node last heard from, or 0.
func (d *Data) LeaderHint(ctx context.Context) uint32 {
	snapshot, err := d.actor.Snapshot(ctx)
	if err != nil {
		return 0
	}
	return snapshot.LeaderID
}

func (d *Data) read(ctx context.Context, confirmed func(readContext string) error) error {
	ctx, cancel := context.WithTimeout(ctx, d.readTimeout)
	defer cancel()
	err := d.actor.Read(ctx, ReadBarrier{
		Begin:     d.controller.BeginFetch,
		Confirmed: confirmed,
		Cancel:    d.controller.CancelFetch,
	})
	switch {
	case errors.Is(err, ErrReadTimeout):
		return fmt.Errorf("%w: %v", replication.ErrReadBarrier, err)
	case errors.Is(err, ErrReadCapacity):
		return fmt.Errorf("%w: %v", replication.ErrBackpressure, err)
	}
	return err
}

func storageRecords(records []storage.LocalRecord) []protocol.FetchedRecord {
	fetched := make([]protocol.FetchedRecord, 0, len(records))
	for _, record := range records {
		item := protocol.FetchedRecord{
			Offset: protocol.DecimalUint64(record.Offset), ValueBase64: base64.StdEncoding.EncodeToString(record.Value),
			AppendTimestampMS: protocol.DecimalUint64(record.AppendTimestamp),
		}
		if record.Key != nil {
			key := base64.StdEncoding.EncodeToString(record.Key)
			item.KeyBase64 = &key
		}
		fetched = append(fetched, item)
	}
	return fetched
}
