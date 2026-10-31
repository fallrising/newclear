package main

import (
	"errors"
	"io"
	"os"
	"syscall"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func loadPolicyProfiles(path string) (map[domain.ProjectID]port.PolicyProfile, error) {
	if path == "" {
		return nil, nil
	}
	deny := func() (map[domain.ProjectID]port.PolicyProfile, error) {
		return nil, errors.New("HAI_TASKBOARD_COMPLETION_POLICIES_FILE is invalid")
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
	if !ok || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 || before.Size() > port.PolicyProfilesLimit {
		return deny()
	}
	data, err := io.ReadAll(io.LimitReader(file, port.PolicyProfilesLimit+1))
	if err != nil || len(data) > port.PolicyProfilesLimit {
		return deny()
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || rejectSymlinkComponents(path) != nil {
		return deny()
	}
	profiles, err := port.ParsePolicyProfiles(data)
	if err != nil {
		return deny()
	}
	return profiles, nil
}
