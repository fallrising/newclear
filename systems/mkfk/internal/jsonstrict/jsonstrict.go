// Package jsonstrict provides bounded JSON decoding with duplicate-key,
// unknown-field, and trailing-value rejection.
package jsonstrict

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Decode validates the JSON token stream before decoding dst. The limit must
// be checked by the caller because different transports have different caps.
func Decode(data []byte, dst any) error {
	if err := rejectDuplicateKeys(data); err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("decode JSON: %w", err)
	}
	if err := expectEOF(dec); err != nil {
		return err
	}
	return nil
}

func rejectDuplicateKeys(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := walkValue(dec); err != nil {
		return fmt.Errorf("validate JSON tokens: %w", err)
	}
	return expectEOF(dec)
}

func walkValue(dec *json.Decoder) error {
	token, err := dec.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := make(map[string]struct{})
		for dec.More() {
			keyToken, err := dec.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("object key is not a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate object key %q", key)
			}
			seen[key] = struct{}{}
			if err := walkValue(dec); err != nil {
				return err
			}
		}
		end, err := dec.Token()
		if err != nil {
			return err
		}
		if end != json.Delim('}') {
			return errors.New("object did not end with '}'")
		}
	case '[':
		for dec.More() {
			if err := walkValue(dec); err != nil {
				return err
			}
		}
		end, err := dec.Token()
		if err != nil {
			return err
		}
		if end != json.Delim(']') {
			return errors.New("array did not end with ']'")
		}
	default:
		return fmt.Errorf("unexpected delimiter %q", delim)
	}
	return nil
}

func expectEOF(dec *json.Decoder) error {
	var trailing any
	err := dec.Decode(&trailing)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return errors.New("multiple JSON values are not allowed")
}
