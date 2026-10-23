package main

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

const (
	maximumIndexBytes = 256 * 1024
	maximumAssetBytes = 4 * 1024 * 1024
	maximumWebBytes   = 16 * 1024 * 1024
	maximumWebAssets  = 64
)

var entryAssetReference = regexp.MustCompile(`(?i)\b(?:src|href)\s*=\s*["']([^"']+)["']`)
var builtAssetPath = regexp.MustCompile(`^/assets/[A-Za-z0-9][A-Za-z0-9_-]*\.(js|css|svg|png|jpg|jpeg|webp|ico|woff|woff2)$`)

type browserAsset struct {
	body      []byte
	mediaType string
}
type browserAssets struct{ routes map[string]browserAsset }

func validateWebRoot(root, dataRoot string) error {
	if !validControlledRoot(root) || filepath.Dir(root) == root || root == filepath.Clean(os.TempDir()) || root == dataRoot || strings.HasPrefix(root, dataRoot+string(filepath.Separator)) || strings.HasPrefix(dataRoot, root+string(filepath.Separator)) {
		return errors.New("HAI_TASKBOARD_WEB_ROOT must be a separate trusted absolute clean build directory")
	}
	if err := rejectSymlinkComponents(root); err != nil {
		return errors.New("HAI_TASKBOARD_WEB_ROOT contains a symlink")
	}
	info, err := os.Lstat(root)
	if err != nil || !trustedWebFile(info, true) {
		return errors.New("HAI_TASKBOARD_WEB_ROOT is not a trusted directory")
	}
	return nil
}

func trustedWebFile(info os.FileInfo, directory bool) bool {
	if info == nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Geteuid()) && (directory && info.IsDir() || !directory && info.Mode().IsRegular() && stat.Nlink == 1)
}

func loadBrowserAssets(root, dataRoot string) (*browserAssets, error) {
	if root == "" {
		return nil, nil
	}
	if err := validateWebRoot(root, dataRoot); err != nil {
		return nil, err
	}
	before, err := os.Lstat(root)
	if err != nil {
		return nil, errors.New("inspect trusted web root")
	}
	// On the pinned Linux target, a trailing slash requires a directory at open,
	// preventing a directory-to-FIFO swap from blocking inside os.OpenRoot.
	descriptor, err := os.OpenRoot(root + string(filepath.Separator))
	if err != nil {
		return nil, errors.New("open trusted web root")
	}
	defer descriptor.Close()
	opened, err := descriptor.Stat(".")
	after, pathErr := os.Lstat(root)
	if err != nil || pathErr != nil || !trustedWebFile(after, true) || !os.SameFile(before, opened) || !os.SameFile(opened, after) {
		return nil, errors.New("web root changed during validation")
	}
	index, err := readBrowserAsset(descriptor, "index.html", maximumIndexBytes)
	if err != nil {
		return nil, err
	}
	assets := &browserAssets{routes: map[string]browserAsset{"/": {index, "text/html; charset=utf-8"}, "/index.html": {index, "text/html; charset=utf-8"}}}
	total := len(index)
	references := entryAssetReference.FindAllSubmatch(index, -1)
	if len(references) == 0 || len(references) > maximumWebAssets {
		return nil, errors.New("web entry has no bounded explicit build assets")
	}
	for _, reference := range references {
		route := string(reference[1])
		if !builtAssetPath.MatchString(route) {
			return nil, errors.New("web entry references an unsupported asset path")
		}
		if _, ok := assets.routes[route]; ok {
			continue
		}
		body, err := readBrowserAsset(descriptor, strings.TrimPrefix(route, "/"), maximumAssetBytes)
		if err != nil {
			return nil, err
		}
		total += len(body)
		if total > maximumWebBytes {
			return nil, errors.New("web build exceeds bounded size")
		}
		types := map[string]string{".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2"}
		assets.routes[route] = browserAsset{body, types[filepath.Ext(route)]}
	}
	return assets, nil
}

func readBrowserAsset(root *os.Root, name string, limit int64) ([]byte, error) {
	parent := filepath.Dir(name)
	var parentBefore os.FileInfo
	if parent != "." {
		info, err := root.Lstat(parent)
		if err != nil || !trustedWebFile(info, true) {
			return nil, errors.New("web asset directory is unsafe")
		}
		parentBefore = info
	}
	before, err := root.Lstat(name)
	if err != nil || !trustedWebFile(before, false) || before.Size() > limit {
		return nil, errors.New("web asset is unsafe or exceeds size bound")
	}
	// A pathname may become a FIFO after Lstat. Open without waiting for a peer;
	// validate the opened descriptor and path identities before reading bytes.
	file, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errors.New("open trusted web asset")
	}
	defer file.Close()
	opened, err := file.Stat()
	after, pathErr := root.Lstat(name)
	if err != nil || pathErr != nil || !trustedWebFile(opened, false) || opened.Size() > limit || !trustedWebFile(after, false) || !os.SameFile(before, opened) || !os.SameFile(opened, after) {
		return nil, errors.New("web asset changed during validation")
	}
	if parentBefore != nil {
		parentAfter, err := root.Lstat(parent)
		if err != nil || !trustedWebFile(parentAfter, true) || !os.SameFile(parentBefore, parentAfter) {
			return nil, errors.New("web asset directory changed during validation")
		}
	}
	body, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(body)) > limit {
		return nil, errors.New("read bounded web asset")
	}
	return body, nil
}

func (assets *browserAssets) serve(response http.ResponseWriter, request *http.Request) bool {
	asset, ok := assets.routes[request.URL.Path]
	if !ok {
		if !strings.HasPrefix(request.URL.Path, "/api/") {
			writeBrowserError(response, http.StatusNotFound, "not_found")
			return true
		}
		return false
	}
	if request.URL.RawPath != "" || request.URL.RawQuery != "" || request.URL.ForceQuery || request.URL.EscapedPath() != request.URL.Path {
		writeBrowserError(response, http.StatusBadRequest, "invalid_request")
		return true
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		writeBrowserError(response, http.StatusMethodNotAllowed, "method_not_allowed")
		return true
	}
	response.Header().Set("Content-Type", asset.mediaType)
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	response.WriteHeader(http.StatusOK)
	if request.Method == http.MethodGet {
		_, _ = response.Write(asset.body)
	}
	return true
}
