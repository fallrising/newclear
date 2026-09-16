package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type DecimalUint64 uint64

func (value DecimalUint64) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatUint(uint64(value), 10))
}

func (value *DecimalUint64) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return errors.New("expected an unsigned decimal JSON string")
	}
	if raw == "" || strings.HasPrefix(raw, "+") || strings.HasPrefix(raw, "-") || len(raw) > 1 && raw[0] == '0' {
		return errors.New("expected a canonical unsigned decimal string")
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return fmt.Errorf("parse unsigned decimal string: %w", err)
	}
	*value = DecimalUint64(parsed)
	return nil
}

type DecimalInt64 int64

func (value DecimalInt64) MarshalJSON() ([]byte, error) {
	return json.Marshal(strconv.FormatInt(int64(value), 10))
}

func (value *DecimalInt64) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return errors.New("expected a signed decimal JSON string")
	}
	digits := strings.TrimPrefix(raw, "-")
	if raw == "" || strings.HasPrefix(raw, "+") || raw == "-0" || digits == "" || len(digits) > 1 && digits[0] == '0' {
		return errors.New("expected a canonical signed decimal string")
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fmt.Errorf("parse signed decimal string: %w", err)
	}
	*value = DecimalInt64(parsed)
	return nil
}

func IsJSONNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}
