package lokiapi

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json/jsontext"
	"errors"
	"io"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

const maxProtocolElements = 100_000
const maxJSONDepth = 16

func decodePush(ctx context.Context, input []byte, compressed bool, limit int) ([]byte, error) {
	if len(input) > limit {
		return nil, pushFailure(spi.ErrTooLarge)
	}
	payload := input
	if compressed {
		reader, err := gzip.NewReader(bytes.NewReader(input))
		if err != nil {
			return nil, pushFailure(spi.ErrBadRequest)
		}
		payload, err = readPushBody(ctx, reader, limit)
		closeErr := reader.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, pushFailure(spi.ErrBadRequest)
		}
	}
	if err := validateTokens(ctx, payload); err != nil {
		return nil, err
	}
	if err := validateShape(ctx, payload, limit); err != nil {
		return nil, err
	}
	return payload, nil
}

// jsontext enforces JSON syntax, unique object names and valid UTF-8. Reading
// tokens never builds the untrusted graph; duplicate tracking is bounded by
// the same count, and nesting is checked before reading the next token.
func validateTokens(ctx context.Context, payload []byte) error {
	decoder := jsontext.NewDecoder(bytes.NewReader(payload))
	count, depth, roots := 0, 0, 0
	for {
		if err := ctx.Err(); err != nil {
			return spi.Wrap(spi.ErrTimeout, "", "loki push", err)
		}
		kind := decoder.PeekKind()
		if (kind == '{' || kind == '[') && depth == maxJSONDepth {
			return pushFailure(spi.ErrTooLarge)
		}
		token, err := decoder.ReadToken()
		if errors.Is(err, io.EOF) {
			if roots == 1 && depth == 0 {
				return nil
			}
			return pushFailure(spi.ErrBadRequest)
		}
		if err != nil {
			return pushFailure(spi.ErrBadRequest)
		}
		if depth == 0 {
			roots++
			if roots > 1 {
				return pushFailure(spi.ErrBadRequest)
			}
		}
		switch token.Kind() {
		case '}', ']':
			depth--
		default:
			count++
			if count > maxProtocolElements {
				return pushFailure(spi.ErrTooLarge)
			}
			if token.Kind() == '{' || token.Kind() == '[' {
				depth++
			}
		}
	}
}

type shapeReader struct {
	ctx                context.Context
	decoder            *jsontext.Decoder
	work, bytes, limit int64
}

func (s *shapeReader) token(kind jsontext.Kind) (string, error) {
	if err := s.ctx.Err(); err != nil {
		return "", spi.Wrap(spi.ErrTimeout, "", "loki push", err)
	}
	token, err := s.decoder.ReadToken()
	if err != nil || token.Kind() != kind {
		return "", pushFailure(spi.ErrBadRequest)
	}
	if kind == '"' {
		return token.String(), nil
	}
	return "", nil
}
func (s *shapeReader) expect(kind jsontext.Kind) error { _, err := s.token(kind); return err }
func (s *shapeReader) stringMap() (members, size int64, err error) {
	if err = s.expect('{'); err != nil {
		return
	}
	for s.decoder.PeekKind() != '}' {
		var key, value string
		key, err = s.token('"')
		if err != nil {
			return
		}
		value, err = s.token('"')
		if err != nil {
			return
		}
		members++
		size += int64(len(key)) + int64(len(value))
	}
	err = s.expect('}')
	return
}
func (s *shapeReader) values() (entries, metadata, size int64, err error) {
	if err = s.expect('['); err != nil {
		return
	}
	for s.decoder.PeekKind() != ']' {
		if err = s.expect('['); err != nil {
			return
		}
		if _, err = s.token('"'); err != nil {
			return
		}
		var body string
		body, err = s.token('"')
		if err != nil {
			return
		}
		size += int64(len(body))
		if s.decoder.PeekKind() != ']' {
			var members, bytes int64
			members, bytes, err = s.stringMap()
			if err != nil {
				return
			}
			metadata += members
			size += bytes
		}
		if err = s.expect(']'); err != nil {
			return
		}
		entries++
	}
	err = s.expect(']')
	return
}
func (s *shapeReader) stream() error {
	if err := s.expect('{'); err != nil {
		return err
	}
	var labels, labelBytes, entries, metadata, entryBytes int64
	var haveLabels, haveValues bool
	for s.decoder.PeekKind() != '}' {
		key, err := s.token('"')
		if err != nil {
			return err
		}
		switch key {
		case "stream":
			labels, labelBytes, err = s.stringMap()
			haveLabels = true
		case "values":
			entries, metadata, entryBytes, err = s.values()
			haveValues = true
		default:
			return pushFailure(spi.ErrBadRequest)
		}
		if err != nil {
			return err
		}
	}
	if err := s.expect('}'); err != nil {
		return err
	}
	if !haveLabels || !haveValues {
		return pushFailure(spi.ErrBadRequest)
	}
	// Conservatively count shared stream labels as per-record allocations even
	// when normalization drops them or can share their storage. This bounds the
	// map-copy amplification that the wire-token limit alone cannot constrain.
	// Three copies conservatively cover label/attribute, resource and severity
	// string ownership. Divide before multiplying, so the guard is overflow-safe.
	if metadata > maxProtocolElements-s.work || entries > (maxProtocolElements-s.work-metadata)/(labels+1) || entryBytes > s.limit-s.bytes || (labelBytes > 0 && entries > (s.limit-s.bytes-entryBytes)/3/labelBytes) {
		return pushFailure(spi.ErrTooLarge)
	}
	s.work += entries*(labels+1) + metadata
	s.bytes += entries*labelBytes*3 + entryBytes
	return nil
}
func validateShape(ctx context.Context, payload []byte, limit int) error {
	s := shapeReader{ctx: ctx, decoder: jsontext.NewDecoder(bytes.NewReader(payload)), limit: int64(limit)}
	if err := s.expect('{'); err != nil {
		return err
	}
	key, err := s.token('"')
	if err != nil || key != "streams" {
		return pushFailure(spi.ErrBadRequest)
	}
	if err := s.expect('['); err != nil {
		return err
	}
	for s.decoder.PeekKind() != ']' {
		if err := s.stream(); err != nil {
			return err
		}
	}
	if err := s.expect(']'); err != nil {
		return err
	}
	return s.expect('}')
}
