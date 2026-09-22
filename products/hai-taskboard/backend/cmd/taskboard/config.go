package main

import (
	"encoding/base64"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const (
	defaultListenAddress = "127.0.0.1:8080"
	defaultLocalActor    = "local-operator"
	encodedTokenLength   = 43
	decodedTokenLength   = 32
)

type runtimeConfig struct {
	DataRoot       string
	ListenAddress  string
	Origin         string
	SessionToken   string
	SessionActor   domain.ActorID
	ShutdownWindow time.Duration
}

func loadRuntimeConfig(getenv func(string) string, args []string) (runtimeConfig, error) {
	if getenv == nil || len(args) != 0 {
		return runtimeConfig{}, errors.New("runtime accepts environment configuration only")
	}
	listenAddress := getenv("HAI_TASKBOARD_LISTEN_ADDR")
	if listenAddress == "" {
		listenAddress = defaultListenAddress
	}
	actor := getenv("HAI_TASKBOARD_SESSION_ACTOR")
	if actor == "" {
		actor = defaultLocalActor
	}
	config := runtimeConfig{
		DataRoot:       getenv("HAI_TASKBOARD_DATA_ROOT"),
		ListenAddress:  listenAddress,
		Origin:         getenv("HAI_TASKBOARD_ORIGIN"),
		SessionToken:   getenv("HAI_TASKBOARD_SESSION_TOKEN"),
		SessionActor:   domain.ActorID(actor),
		ShutdownWindow: 5 * time.Second,
	}
	if err := config.validate(); err != nil {
		return runtimeConfig{}, err
	}
	return config, nil
}

func (config runtimeConfig) validate() error {
	if err := validateDataRoot(config.DataRoot); err != nil {
		return errors.New("HAI_TASKBOARD_DATA_ROOT must be an absolute clean controlled path")
	}
	_, _, err := loopbackEndpoint(config.ListenAddress)
	if err != nil {
		return errors.New("HAI_TASKBOARD_LISTEN_ADDR must be a canonical explicit loopback IP and non-zero port")
	}
	if config.Origin != "http://"+config.ListenAddress {
		return errors.New("HAI_TASKBOARD_ORIGIN must exactly match the loopback listener")
	}
	if !validSessionToken(config.SessionToken) {
		return errors.New("HAI_TASKBOARD_SESSION_TOKEN is missing or insufficiently strong")
	}
	if !validActor(string(config.SessionActor)) {
		return errors.New("HAI_TASKBOARD_SESSION_ACTOR is invalid")
	}
	if config.ShutdownWindow <= 0 || config.ShutdownWindow > 30*time.Second {
		return errors.New("runtime shutdown window is invalid")
	}
	return nil
}

func loopbackEndpoint(address string) (net.IP, uint16, error) {
	host, portText, err := net.SplitHostPort(address)
	if err != nil || host == "" || portText == "" {
		return nil, 0, errors.New("invalid listen address")
	}
	ip := net.ParseIP(host)
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil || port == 0 || ip == nil || !ip.IsLoopback() {
		return nil, 0, errors.New("listen address is not loopback")
	}
	canonical := net.JoinHostPort(ip.String(), strconv.Itoa(int(port)))
	if address != canonical {
		return nil, 0, errors.New("listen address is not canonical")
	}
	return ip, uint16(port), nil
}

func validControlledRoot(root string) bool {
	return root != "" && filepath.IsAbs(root) && filepath.Clean(root) == root &&
		!strings.ContainsAny(root, "\x00\r\n")
}

func validateDataRoot(root string) error {
	if !validControlledRoot(root) || filepath.Dir(root) == root || root == filepath.Clean(os.TempDir()) {
		return errors.New("runtime root is broad or invalid")
	}
	if err := rejectSymlinkComponents(root); err != nil {
		return err
	}

	current := root
	for {
		info, err := os.Lstat(current)
		if err == nil {
			stat, owned := info.Sys().(*syscall.Stat_t)
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o700 ||
				!owned || stat.Uid != uint32(os.Geteuid()) {
				return errors.New("runtime root is not private")
			}
			return nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return errors.New("inspect runtime root")
		}
		parent := filepath.Dir(current)
		if parent == current {
			return errors.New("runtime root has no controlled parent")
		}
		current = parent
	}
}

func validSessionToken(token string) bool {
	if len(token) != encodedTokenLength {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != decodedTokenLength || base64.RawURLEncoding.EncodeToString(decoded) != token {
		return false
	}
	return !obviouslyPredictable(decoded)
}

func obviouslyPredictable(value []byte) bool {
	unique := make(map[byte]struct{}, len(value))
	for _, item := range value {
		unique[item] = struct{}{}
	}
	if len(unique) < decodedTokenLength/2 {
		return true
	}

	for period := 1; period <= len(value)/2; period++ {
		periodic := true
		for index := period; index < len(value); index++ {
			if value[index] != value[index%period] {
				periodic = false
				break
			}
		}
		if periodic {
			return true
		}
	}

	delta := value[1] - value[0]
	for index := 2; index < len(value); index++ {
		if value[index]-value[index-1] != delta {
			return false
		}
	}
	return true
}

func validActor(actor string) bool {
	if len(actor) < 1 || len(actor) > 120 {
		return false
	}
	for _, character := range actor {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || character == '_' || character == '-' || character == '.' {
			continue
		}
		return false
	}
	return true
}
