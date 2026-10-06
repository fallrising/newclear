ALTER TABLE metric_samples ADD COLUMN IF NOT EXISTS value_bits UInt64 DEFAULT reinterpretAsUInt64(value);
