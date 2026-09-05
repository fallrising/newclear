package config

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
)

func validateNotify(ctx context.Context, notify NotifyConfig) (notifyState, error) {
	var state notifyState
	if err := validateReadableFile(ctx, "notify.config_path", notify.ConfigPath, true); err != nil {
		return state, err
	}
	content, err := readBounded(ctx, notify.ConfigPath, maxAuxiliaryFileBytes)
	if err != nil {
		return state, fmt.Errorf("read notify.config_path: %w", err)
	}
	document, err := parseYAMLDocument(content)
	if err != nil {
		return state, fmt.Errorf("parse notify.config_path: %w", err)
	}
	root, ok := document.(map[string]any)
	if !ok {
		return state, fmt.Errorf("notify.config_path must contain a mapping")
	}

	receivers, receiverErr := notificationReceivers(root["receivers"])
	route, routeOK := root["route"].(map[string]any)
	if !routeOK {
		return state, errors.Join(receiverErr, fmt.Errorf("notify route must be a mapping"))
	}
	routeReceivers, routeErr := notificationRouteReceivers(route, 0, true)
	var errs []error
	errs = append(errs, receiverErr, routeErr)
	for _, receiver := range routeReceivers {
		if !receivers[receiver] {
			errs = append(errs, fmt.Errorf("notify route references unknown receiver %q", receiver))
		}
	}
	if notify.DeadletterReceiver == "" {
		errs = append(errs, fmt.Errorf("notify.deadletter_receiver is required"))
	} else if !receivers[notify.DeadletterReceiver] {
		errs = append(errs, fmt.Errorf("notify.deadletter_receiver %q does not exist", notify.DeadletterReceiver))
	}
	state.hasWatchdog = receivers["watchdog"] && slices.Contains(routeReceivers, "watchdog")
	if err := validateNotificationSecrets(ctx, root, filepath.Dir(notify.ConfigPath), "notification"); err != nil {
		errs = append(errs, err)
	}
	return state, errors.Join(errs...)
}

func notificationReceivers(value any) (map[string]bool, error) {
	sequence, ok := value.([]any)
	if !ok || len(sequence) == 0 {
		return map[string]bool{}, fmt.Errorf("notify receivers must be a non-empty sequence")
	}
	result := make(map[string]bool, len(sequence))
	var errs []error
	for index, item := range sequence {
		receiver, ok := item.(map[string]any)
		if !ok {
			errs = append(errs, fmt.Errorf("notify receivers[%d] must be a mapping", index))
			continue
		}
		name := scalarString(receiver["name"])
		if name == "" {
			errs = append(errs, fmt.Errorf("notify receivers[%d].name must not be empty", index))
			continue
		}
		if result[name] {
			errs = append(errs, fmt.Errorf("notify receiver %q is duplicated", name))
		}
		result[name] = true
	}
	return result, errors.Join(errs...)
}

func notificationRouteReceivers(route map[string]any, depth int, root bool) ([]string, error) {
	if depth > 100 {
		return nil, fmt.Errorf("notify route nesting exceeds 100 levels")
	}
	result := make([]string, 0)
	receiver := scalarString(route["receiver"])
	if receiver != "" {
		result = append(result, receiver)
	} else if root {
		return nil, fmt.Errorf("notify root route must name a receiver")
	}
	childrenValue, hasChildren := route["routes"]
	if !hasChildren {
		return result, nil
	}
	children, ok := childrenValue.([]any)
	if !ok {
		return result, fmt.Errorf("notify route.routes must be a sequence")
	}
	var errs []error
	for index, item := range children {
		child, ok := item.(map[string]any)
		if !ok {
			errs = append(errs, fmt.Errorf("notify route.routes[%d] must be a mapping", index))
			continue
		}
		childReceivers, err := notificationRouteReceivers(child, depth+1, false)
		result = append(result, childReceivers...)
		if err != nil {
			errs = append(errs, err)
		}
	}
	return result, errors.Join(errs...)
}

func validateNotificationSecrets(ctx context.Context, value any, base, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var errs []error
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			itemPath := path + "." + key
			if strings.HasSuffix(strings.ToLower(key), "_file") {
				filePath := scalarString(item)
				if filePath == "" {
					errs = append(errs, fmt.Errorf("%s must name a file", itemPath))
					continue
				}
				filePath = resolveRelativePath(base, filePath)
				if err := validateReadableFile(ctx, itemPath, filePath, true); err != nil {
					errs = append(errs, err)
				}
				continue
			}
			if isCredentialKey(key) && isPlaintextCredential(item) {
				errs = append(errs, fmt.Errorf("%s appears to contain a plaintext credential; use a _file field or secret reference", itemPath))
			}
			if strings.EqualFold(key, "url") && urlContainsCredential(item) {
				errs = append(errs, fmt.Errorf("%s appears to embed a plaintext credential", itemPath))
			}
			if err := validateNotificationSecrets(ctx, item, base, itemPath); err != nil {
				errs = append(errs, err)
			}
		}
	case []any:
		for index, item := range current {
			if err := validateNotificationSecrets(ctx, item, base, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

func isCredentialKey(key string) bool {
	normalized := strings.ToLower(key)
	return slices.Contains([]string{
		"api_key", "api_secret", "api_url", "auth_password", "bearer_token", "client_secret",
		"password", "routing_key", "secret", "service_key", "token", "webhook_url",
	}, normalized) || strings.HasSuffix(normalized, "_password") || strings.HasSuffix(normalized, "_secret") || strings.HasSuffix(normalized, "_token")
}

func isPlaintextCredential(value any) bool {
	raw := scalarString(value)
	if raw == "" {
		return false
	}
	if strings.HasPrefix(raw, "${") && strings.HasSuffix(raw, "}") {
		return false
	}
	return !strings.HasPrefix(raw, "secret://") && !strings.HasPrefix(raw, "file://")
}

func urlContainsCredential(value any) bool {
	raw := scalarString(value)
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() {
		return false
	}
	if parsed.User != nil {
		return true
	}
	for key := range parsed.Query() {
		if isCredentialKey(key) {
			return true
		}
	}
	return false
}
