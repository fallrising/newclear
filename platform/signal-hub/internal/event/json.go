package event

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"strconv"
	"unicode/utf8"
)

// Decode parses one JSON value without repairing malformed Unicode, silently
// replacing duplicate object members, or rounding unsafe integer literals.
// Numbers retain their original JSON representation.
func Decode(raw []byte) (any, error) {
	if !utf8.Valid(raw) {
		return nil, failure(400, "invalid_json", "JSON must be valid UTF-8")
	}
	if err := checkStrings(raw); err != nil {
		return nil, failure(400, "invalid_json", err.Error())
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	v, err := decodeValue(d, 0)
	if err != nil {
		return nil, failure(400, "invalid_json", "invalid JSON: "+err.Error())
	}
	if _, err = d.Token(); err != io.EOF {
		return nil, failure(400, "invalid_json", "expected one JSON value")
	}
	return v, nil
}

func decodeValue(d *json.Decoder, depth int) (any, error) {
	t, err := d.Token()
	if err != nil {
		return nil, err
	}
	switch v := t.(type) {
	case json.Delim:
		// Depth counts enclosing containers, not scalar leaves. Reject the
		// 65th opening even if it is empty and has no recursive child.
		if (v == '{' || v == '[') && depth >= 64 {
			return nil, fmt.Errorf("nesting exceeds supported depth")
		}
		switch v {
		case '{':
			m := map[string]any{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return nil, err
				}
				k, ok := key.(string)
				if !ok {
					return nil, fmt.Errorf("object key is not a string")
				}
				if _, exists := m[k]; exists {
					return nil, fmt.Errorf("duplicate object key")
				}
				item, err := decodeValue(d, depth+1)
				if err != nil {
					return nil, err
				}
				m[k] = item
			}
			if end, err := d.Token(); err != nil || end != json.Delim('}') {
				return nil, fmt.Errorf("invalid object")
			}
			return m, nil
		case '[':
			a := []any{}
			for d.More() {
				item, err := decodeValue(d, depth+1)
				if err != nil {
					return nil, err
				}
				a = append(a, item)
			}
			if end, err := d.Token(); err != nil || end != json.Delim(']') {
				return nil, fmt.Errorf("invalid array")
			}
			return a, nil
		default:
			return nil, fmt.Errorf("unexpected delimiter")
		}
	case json.Number:
		s := string(v)
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			return nil, fmt.Errorf("number outside finite IEEE-754 range")
		}
		// Integral JSON literals have exact integer semantics before JCS conversion.
		if !bytes.ContainsAny([]byte(s), ".eE") {
			n, ok := new(big.Int).SetString(s, 10)
			if !ok || n.Cmp(big.NewInt(9007199254740991)) > 0 || n.Cmp(big.NewInt(-9007199254740991)) < 0 {
				return nil, fmt.Errorf("integer outside JCS safe range")
			}
		}
		return v, nil
	default:
		return t, nil
	}
}

// encoding/json replaces unpaired surrogate escapes with U+FFFD. Validate the
// original string lexemes first, including object member names.
func checkStrings(raw []byte) error {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '"' {
			continue
		}
		i++
		for ; i < len(raw) && raw[i] != '"'; i++ {
			if raw[i] != '\\' {
				continue
			}
			i++
			if i >= len(raw) {
				return fmt.Errorf("unfinished string escape")
			}
			if raw[i] != 'u' {
				continue
			}
			if i+4 >= len(raw) {
				return fmt.Errorf("unfinished Unicode escape")
			}
			n, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
			if err != nil {
				return fmt.Errorf("invalid Unicode escape")
			}
			i += 4
			if n >= 0xDC00 && n <= 0xDFFF {
				return fmt.Errorf("unpaired Unicode surrogate")
			}
			if n >= 0xD800 && n <= 0xDBFF {
				if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
					return fmt.Errorf("unpaired Unicode surrogate")
				}
				low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
				if err != nil || low < 0xDC00 || low > 0xDFFF {
					return fmt.Errorf("unpaired Unicode surrogate")
				}
				i += 6
			}
		}
	}
	return nil
}
