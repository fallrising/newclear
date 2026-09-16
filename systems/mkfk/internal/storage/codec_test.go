package storage

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type walVector struct {
	Name     string    `json:"name"`
	Kind     EntryKind `json:"kind"`
	LogIndex uint64    `json:"log_index"`
	Term     uint64    `json:"term"`
	Payload  string    `json:"payload"`
	Hex      string    `json:"hex"`
}

func TestWALGoldenVectors(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "wal-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vectors []walVector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors {
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			t.Parallel()
			frame := Frame{Kind: vector.Kind, LogIndex: vector.LogIndex, Term: vector.Term, Payload: []byte(vector.Payload)}
			encoded, err := EncodeFrame(frame)
			if err != nil {
				t.Fatal(err)
			}
			if got := hex.EncodeToString(encoded); got != vector.Hex {
				t.Fatalf("encoded hex = %s, want %s", got, vector.Hex)
			}
			decoded, consumed, err := DecodeFrame(encoded)
			if err != nil {
				t.Fatal(err)
			}
			if consumed != len(encoded) || !reflect.DeepEqual(decoded, frame) {
				t.Fatalf("round trip = %#v, %d; want %#v, %d", decoded, consumed, frame, len(encoded))
			}
		})
	}
}

func TestFrameRejectsCorruptionAndLengths(t *testing.T) {
	t.Parallel()
	encoded, err := EncodeFrame(Frame{Kind: KindNOOP, LogIndex: 1, Term: 1, Payload: []byte(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	corrupt := append([]byte(nil), encoded...)
	corrupt[len(corrupt)-1] ^= 1
	if _, _, err := DecodeFrame(corrupt); err == nil {
		t.Fatal("checksum corruption was accepted")
	}
	if _, _, err := DecodeFrame([]byte{0xff, 0xff, 0xff, 0xff}); err == nil {
		t.Fatal("oversized declared length was accepted")
	}
	for cut := 0; cut < len(encoded); cut++ {
		if _, _, err := DecodeFrame(encoded[:cut]); err == nil {
			t.Fatalf("partial frame of %d bytes was accepted", cut)
		}
	}
}

type indexVector struct {
	Entries []struct {
		BaseOffset   uint64 `json:"base_offset"`
		FilePosition uint64 `json:"file_position"`
		LogIndex     uint64 `json:"log_index"`
	} `json:"entries"`
	Hex string `json:"hex"`
}

func TestIndexGoldenVector(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "index-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vector indexVector
	if err := json.Unmarshal(data, &vector); err != nil {
		t.Fatal(err)
	}
	entries := make([]IndexEntry, len(vector.Entries))
	for i, entry := range vector.Entries {
		entries[i] = IndexEntry(entry)
	}
	encoded, err := EncodeIndex(entries)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(encoded); got != vector.Hex {
		t.Fatalf("encoded hex = %s, want %s", got, vector.Hex)
	}
	decoded, err := DecodeIndex(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded, entries) {
		t.Fatalf("decoded entries = %#v, want %#v", decoded, entries)
	}
	corrupt := append([]byte(nil), encoded...)
	corrupt[len(corrupt)-1] ^= 1
	if _, err := DecodeIndex(corrupt); err == nil {
		t.Fatal("corrupt index checksum was accepted")
	}
	if bytes.Equal(encoded, corrupt) {
		t.Fatal("test did not corrupt index")
	}
}
