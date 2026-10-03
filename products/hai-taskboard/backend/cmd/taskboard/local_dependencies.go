package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

const maximumArtifactBytes = 10 * 1024 * 1024

var crockfordEncoding = base32.NewEncoding("0123456789ABCDEFGHJKMNPQRSTVWXYZ").WithPadding(base32.NoPadding)

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now().UTC() }

type cryptoIDSource struct{}

func (cryptoIDSource) Next(kind port.IDKind) (string, error) {
	var entropy [16]byte
	if _, err := io.ReadFull(rand.Reader, entropy[:]); err != nil {
		return "", fmt.Errorf("generate application identity: %w", err)
	}
	prefix, ok := map[port.IDKind]string{
		port.IDAuditGroup:          "audit_",
		port.IDRun:                 "run_",
		port.IDOutbox:              "outbox_",
		port.IDCompletionRecord:    "completion_",
		port.IDApprovalConsumption: "consumption_",
	}[kind]
	if !ok {
		return "", errors.New("unsupported application identity kind")
	}
	return prefix + crockfordEncoding.EncodeToString(entropy[:]), nil
}

type localArtifactStore struct {
	configuredRoot string
	root           *os.Root
	identity       os.FileInfo
}

func newLocalArtifactStore(root string) (*localArtifactStore, error) {
	if !validControlledRoot(root) {
		return nil, errors.New("artifact root is invalid")
	}
	if err := ensurePrivateDirectory(root); err != nil {
		return nil, err
	}
	pathInfo, err := os.Lstat(root)
	if err != nil || !pathInfo.IsDir() || pathInfo.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("artifact root is unsafe")
	}
	descriptor, err := os.OpenRoot(root)
	if err != nil {
		return nil, errors.New("open artifact root")
	}
	descriptorInfo, err := descriptor.Stat(".")
	if err != nil || !descriptorInfo.IsDir() || !os.SameFile(pathInfo, descriptorInfo) {
		_ = descriptor.Close()
		return nil, errors.New("bind artifact root identity")
	}
	pathInfoAfter, err := os.Lstat(root)
	if err != nil || pathInfoAfter.Mode()&os.ModeSymlink != 0 || !os.SameFile(descriptorInfo, pathInfoAfter) {
		_ = descriptor.Close()
		return nil, errors.New("artifact root changed during construction")
	}
	return &localArtifactStore{configuredRoot: root, root: descriptor, identity: descriptorInfo}, nil
}

func (store *localArtifactStore) Put(ctx context.Context, source io.Reader) (domain.Digest, uint64, error) {
	if store == nil || source == nil {
		return domain.Digest{}, 0, errors.New("artifact input is invalid")
	}
	if err := ctx.Err(); err != nil {
		return domain.Digest{}, 0, err
	}
	if err := store.checkRootIdentity(); err != nil {
		return domain.Digest{}, 0, err
	}
	temporaryName, temporary, err := store.createTemporary()
	if err != nil {
		return domain.Digest{}, 0, errors.New("create artifact staging file")
	}
	defer store.root.Remove(temporaryName)

	limited := io.LimitReader(source, maximumArtifactBytes+1)
	bytes, readErr := io.ReadAll(limited)
	if readErr != nil || len(bytes) == 0 || len(bytes) > maximumArtifactBytes {
		temporary.Close()
		return domain.Digest{}, 0, errors.New("artifact content is invalid")
	}
	if err := ctx.Err(); err != nil {
		temporary.Close()
		return domain.Digest{}, 0, err
	}
	if _, err := temporary.Write(bytes); err != nil {
		temporary.Close()
		return domain.Digest{}, 0, errors.New("write artifact staging file")
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return domain.Digest{}, 0, errors.New("sync artifact staging file")
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		temporary.Close()
		return domain.Digest{}, 0, errors.New("rewind artifact staging file")
	}
	staged, err := io.ReadAll(io.LimitReader(temporary, maximumArtifactBytes+1))
	if err != nil || len(staged) != len(bytes) {
		temporary.Close()
		return domain.Digest{}, 0, errors.New("validate artifact staging file")
	}
	if err := temporary.Close(); err != nil {
		return domain.Digest{}, 0, errors.New("close artifact staging file")
	}

	digest := domain.HashBytes(staged)
	destination := digest.String()
	if err := store.root.Link(temporaryName, destination); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return domain.Digest{}, 0, errors.New("publish artifact")
		}
		existing, err := store.openValidated(digest)
		if err != nil {
			return domain.Digest{}, 0, err
		}
		if err := existing.Close(); err != nil {
			return domain.Digest{}, 0, errors.New("close existing artifact")
		}
	}
	if err := store.syncRoot(); err != nil {
		return domain.Digest{}, 0, err
	}
	return digest, uint64(len(bytes)), nil
}

func (store *localArtifactStore) Open(ctx context.Context, digest domain.Digest) (io.ReadCloser, error) {
	if store == nil || digest.IsZero() {
		return nil, errors.New("artifact identity is invalid")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := store.checkRootIdentity(); err != nil {
		return nil, err
	}
	return store.openValidated(digest)
}

func (store *localArtifactStore) Close() error {
	if store == nil || store.root == nil {
		return nil
	}
	return store.root.Close()
}

func (store *localArtifactStore) checkRootIdentity() error {
	if store == nil || store.root == nil || store.identity == nil {
		return errors.New("artifact store is closed")
	}
	pathInfo, err := os.Lstat(store.configuredRoot)
	if err != nil || !pathInfo.IsDir() || pathInfo.Mode()&os.ModeSymlink != 0 || !os.SameFile(store.identity, pathInfo) {
		return errors.New("artifact root identity changed")
	}
	return nil
}

func (store *localArtifactStore) createTemporary() (string, *os.File, error) {
	for range 128 {
		var entropy [16]byte
		if _, err := io.ReadFull(rand.Reader, entropy[:]); err != nil {
			return "", nil, err
		}
		name := ".artifact-" + hex.EncodeToString(entropy[:])
		file, err := store.root.OpenFile(name, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			return name, file, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", nil, err
		}
	}
	return "", nil, errors.New("artifact staging namespace exhausted")
}

func (store *localArtifactStore) openValidated(expected domain.Digest) (*os.File, error) {
	name := expected.String()
	if !validArtifactName(name) {
		return nil, errors.New("artifact name is unsafe")
	}
	pathInfo, err := store.root.Lstat(name)
	if err != nil || !pathInfo.Mode().IsRegular() || pathInfo.Mode()&os.ModeSymlink != 0 ||
		pathInfo.Size() < 1 || pathInfo.Size() > maximumArtifactBytes {
		return nil, errors.New("artifact object is unsafe")
	}
	file, err := store.root.Open(name)
	if err != nil {
		return nil, errors.New("open artifact")
	}
	closeWithError := func(err error) (*os.File, error) {
		_ = file.Close()
		return nil, err
	}
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(pathInfo, openedInfo) ||
		openedInfo.Size() < 1 || openedInfo.Size() > maximumArtifactBytes {
		return closeWithError(errors.New("artifact object changed during open"))
	}
	contents, err := io.ReadAll(io.LimitReader(file, maximumArtifactBytes+1))
	if err != nil || len(contents) == 0 || len(contents) > maximumArtifactBytes || domain.HashBytes(contents) != expected {
		return closeWithError(errors.New("artifact object failed integrity validation"))
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return closeWithError(errors.New("rewind artifact object"))
	}
	return file, nil
}

func (store *localArtifactStore) syncRoot() error {
	directory, err := store.root.Open(".")
	if err != nil {
		return errors.New("open artifact directory")
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return errors.New("sync artifact directory")
	}
	return nil
}

func safeArtifactPath(root, name string) (string, error) {
	if !validArtifactName(name) || !validControlledRoot(root) {
		return "", errors.New("artifact name is unsafe")
	}
	path := filepath.Join(root, name)
	relative, err := filepath.Rel(root, path)
	if err != nil || relative != name || filepath.IsAbs(relative) || strings.HasPrefix(relative, "..") {
		return "", errors.New("artifact path escapes root")
	}
	return path, nil
}

func validArtifactName(name string) bool {
	if len(name) != 64 {
		return false
	}
	for _, digit := range name {
		if digit >= '0' && digit <= '9' || digit >= 'a' && digit <= 'f' {
			continue
		}
		return false
	}
	return true
}

func ensurePrivateDirectory(path string) error {
	if err := validateDataRoot(path); err != nil {
		return errors.New("runtime path is invalid")
	}
	if err := os.MkdirAll(path, 0o700); err != nil {
		return errors.New("create runtime directory")
	}
	if err := validateDataRoot(path); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return errors.New("runtime directory is unsafe")
	}
	return nil
}

func rejectSymlinkComponents(path string) error {
	volume := filepath.VolumeName(path)
	current := string(filepath.Separator)
	remainder := strings.TrimPrefix(path, volume+string(filepath.Separator))
	if volume != "" {
		current = volume + string(filepath.Separator)
	}
	for component := range strings.SplitSeq(remainder, string(filepath.Separator)) {
		if component == "" {
			continue
		}
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return errors.New("inspect runtime path")
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("runtime path contains a symlink")
		}
	}
	return nil
}

type localSessionAuthority struct {
	tokenDigest [sha256.Size]byte
	session     httpapi.Session
	notRevoked  <-chan struct{}
}

func newLocalSessionAuthority(token string, actor domain.ActorID) (*localSessionAuthority, error) {
	if !validSessionToken(token) || !validActor(string(actor)) {
		return nil, errors.New("local session configuration is invalid")
	}
	never := make(chan struct{})
	return &localSessionAuthority{
		tokenDigest: sha256.Sum256([]byte(token)),
		session:     httpapi.Session{ID: "local-session", Principal: actor},
		notRevoked:  never,
	}, nil
}

func (authority *localSessionAuthority) Authenticate(ctx context.Context, token string) (httpapi.Session, error) {
	if authority == nil {
		return httpapi.Session{}, httpapi.ErrUnauthenticated
	}
	if err := ctx.Err(); err != nil {
		return httpapi.Session{}, err
	}
	candidate := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(candidate[:], authority.tokenDigest[:]) != 1 {
		return httpapi.Session{}, httpapi.ErrUnauthenticated
	}
	return authority.session, nil
}

func (authority *localSessionAuthority) AuthorizeProject(ctx context.Context, session httpapi.Session, projectID domain.ProjectID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if authority == nil || session != authority.session || projectID == "" {
		return httpapi.ErrPermissionDenied
	}
	return nil
}

func (authority *localSessionAuthority) AuthorizeCommandResult(ctx context.Context, session httpapi.Session, projectID domain.ProjectID, commandID string) error {
	if commandID == "" {
		return httpapi.ErrPermissionDenied
	}
	return authority.AuthorizeProject(ctx, session, projectID)
}

func (authority *localSessionAuthority) Revoked(session httpapi.Session) <-chan struct{} {
	if authority == nil || session != authority.session {
		revoked := make(chan struct{})
		close(revoked)
		return revoked
	}
	return authority.notRevoked
}

type unavailableProjectionSource struct{}

func (unavailableProjectionSource) Snapshot(context.Context, domain.ProjectID) (httpapi.ProjectionSnapshot, error) {
	return httpapi.ProjectionSnapshot{}, httpapi.ErrProjectionNotFound
}

func (unavailableProjectionSource) Replay(context.Context, domain.ProjectID, port.Cursor) (httpapi.ProjectionReplay, error) {
	return httpapi.ProjectionReplay{}, httpapi.ErrProjectionNotFound
}

type unavailableSpecification struct{}

func (unavailableSpecification) ValidFor(domain.ProjectID, domain.WorkItemID, []port.ACRequirement) bool {
	return false
}

func newLocalFakeAdapter() (*fake.Adapter, error) {
	capabilities := []fake.Capability{
		fake.CapabilityStartAck,
		fake.CapabilityHeartbeat,
		fake.CapabilityLookup,
		fake.CapabilityCancelAck,
		fake.CapabilityDurableCheckpoint,
	}
	scenario, err := fake.NewScenario("local-success", capabilities, []fake.Step{
		{Tick: 0, Kind: fake.ObservationDispatchReceived, Message: "accepted"},
		{Tick: 1, Kind: fake.ObservationStartAcknowledged, Message: "started"},
		{Tick: 2, Kind: fake.ObservationTerminalSuccess, Message: "completed"},
	})
	if err != nil {
		return nil, err
	}
	return fake.NewAdapter(capabilities, []fake.Scenario{scenario}, nil)
}

var _ port.Clock = systemClock{}
var _ port.IDSource = cryptoIDSource{}
var _ port.ArtifactStore = (*localArtifactStore)(nil)
var _ httpapi.SessionAuthority = (*localSessionAuthority)(nil)
var _ httpapi.ProjectionSource = unavailableProjectionSource{}
