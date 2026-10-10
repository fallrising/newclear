-- Canonical key/value bytes sort identically to the Go label comparator.
ALTER TABLE metric_series ADD COLUMN IF NOT EXISTS labels_str String MATERIALIZED
    arrayStringConcat(arraySort(arrayMap((k, v) -> concat(k, '\x00', v),
        mapKeys(labels), mapValues(labels))), '\x01');
