package main

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/gitobject"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

const maximumRepositoryFile = 64 << 10

type repositoryRegistry struct {
	entries map[repositoryKey]port.ApprovedRepository
}
type repositoryKey struct {
	project domain.ProjectID
	id      string
}

func (r *repositoryRegistry) Lookup(project domain.ProjectID, id string) (port.ApprovedRepository, error) {
	if r == nil {
		return port.ApprovedRepository{}, errors.New("repository unavailable")
	}
	value, ok := r.entries[repositoryKey{project, id}]
	if !ok {
		return port.ApprovedRepository{}, errors.New("repository unavailable")
	}
	value.Refs = slices.Clone(value.Refs)
	value.ManifestPaths = slices.Clone(value.ManifestPaths)
	return value, nil
}

type repositoryFile struct {
	Schema       jsontext.Value    `json:"schema_version"`
	Repositories []repositoryEntry `json:"repositories"`
}
type repositoryEntry struct {
	Project       domain.ProjectID           `json:"project_id"`
	ID            string                     `json:"id"`
	Version       jsontext.Value             `json:"version"`
	Format        specification.ObjectFormat `json:"object_format"`
	Configuration string                     `json:"configuration_id"`
	Approver      domain.ActorID             `json:"approved_by_actor"`
	Refs          []string                   `json:"refs"`
	Paths         []string                   `json:"manifest_paths"`
	Git           string                     `json:"git_executable"`
	Dir           string                     `json:"git_dir"`
}

// Open each component relative to the prior descriptor, never following symlinks.
// O_NONBLOCK prevents a raced FIFO/device replacement from blocking startup.
func openRepositoryFile(path string) (*os.File, error) {
	if !validControlledRoot(path) {
		return nil, errors.New("invalid repository configuration")
	}
	fd, err := syscall.Open("/", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for i, part := range parts {
		flags := syscall.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK
		if i < len(parts)-1 {
			flags |= syscall.O_DIRECTORY
		}
		next, e := syscall.Openat(fd, part, flags, 0)
		syscall.Close(fd)
		if e != nil {
			return nil, e
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), "approved-repository-configuration"), nil
}
func loadRepositoryRegistry(path string, actor domain.ActorID, dataRoot string) (*repositoryRegistry, error) {
	if path == "" {
		return nil, nil
	}
	deny := func() (*repositoryRegistry, error) {
		return nil, errors.New("HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE is invalid")
	}
	file, err := openRepositoryFile(path)
	if err != nil {
		return deny()
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return deny()
	}
	stat, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 || before.Size() > maximumRepositoryFile {
		return deny()
	}
	bytes, err := io.ReadAll(io.LimitReader(file, maximumRepositoryFile+1))
	if err != nil || len(bytes) > maximumRepositoryFile {
		return deny()
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || rejectSymlinkComponents(path) != nil {
		return deny()
	}
	var input repositoryFile
	if json.Unmarshal(bytes, &input, json.RejectUnknownMembers(true)) != nil || string(input.Schema) != "1" || input.Repositories == nil || len(input.Repositories) > 32 {
		return deny()
	}
	registry := &repositoryRegistry{entries: make(map[repositoryKey]port.ApprovedRepository)}
	scratch := filepath.Join(dataRoot, "repository-scratch")
	for _, entry := range input.Repositories {
		version, err := strconv.ParseUint(string(entry.Version), 10, 63)
		if err != nil || version == 0 || strconv.FormatUint(version, 10) != string(entry.Version) || entry.Approver != actor {
			return deny()
		}
		value := port.ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: entry.Project, ID: entry.ID, Version: version, ObjectFormat: entry.Format}, ConfigurationID: entry.Configuration, ApprovedBy: entry.Approver, Refs: slices.Clone(entry.Refs), ManifestPaths: slices.Clone(entry.Paths)}
		_, digest, err := port.CanonicalRepositoryBinding(value)
		if err != nil {
			return deny()
		}
		value.Binding.Digest = digest
		key := repositoryKey{entry.Project, entry.ID}
		if _, exists := registry.entries[key]; exists {
			return deny()
		}
		reader, err := gitobject.New(gitobject.Config{GitExecutable: entry.Git, GitDir: entry.Dir, ScratchDir: scratch, ObjectFormat: entry.Format, AllowedRefs: value.Refs})
		if err != nil {
			return deny()
		}
		value.Reader = reader
		registry.entries[key] = value
	}
	return registry, nil
}
