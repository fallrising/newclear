// Command mkfkdemo walks the M7 demo against the Compose experiment that
// `make demo` started: produce and consume, a lost reply retried, a killed
// partition leader and its catch-up, a rebalance, and a coordinator restart
// that resumes from committed offsets. It only signals this project's
// containers.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

type demo struct {
	project, composeFile, docker string
	client, admin                map[uint32]string
	http                         *http.Client
}

func main() {
	d := &demo{http: &http.Client{Timeout: 3 * time.Second}}
	var client, admin string
	flag.StringVar(&d.project, "project", "mkfk-demo", "Compose project of the experiment")
	flag.StringVar(&d.composeFile, "compose-file", "deploy/compose.yaml", "Compose file")
	flag.StringVar(&d.docker, "docker", "docker", "docker CLI")
	flag.StringVar(&client, "client", "1=127.0.0.1:19091,2=127.0.0.1:19092,3=127.0.0.1:19093", "published client listeners")
	flag.StringVar(&admin, "admin", "1=127.0.0.1:19291,2=127.0.0.1:19292,3=127.0.0.1:19293", "published admin listeners")
	flag.Parse()
	var err error
	if d.client, err = parseAddresses(client); err == nil {
		d.admin, err = parseAddresses(admin)
	}
	if err == nil {
		err = d.run()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "demo failed:", err)
		os.Exit(1)
	}
}

func parseAddresses(value string) (map[uint32]string, error) {
	addresses := map[uint32]string{}
	for _, pair := range strings.Split(value, ",") {
		id, address, ok := strings.Cut(pair, "=")
		parsed, err := strconv.ParseUint(id, 10, 32)
		if !ok || err != nil || parsed == 0 || address == "" {
			return nil, fmt.Errorf("invalid broker address %q", pair)
		}
		addresses[uint32(parsed)] = address
	}
	return addresses, nil
}

func step(format string, arguments ...any) {
	fmt.Printf("\n== "+format+"\n", arguments...)
}

func note(format string, arguments ...any) {
	fmt.Printf("   "+format+"\n", arguments...)
}

// compose runs one docker compose command against this project only.
func (d *demo) compose(arguments ...string) error {
	command := exec.Command(d.docker, append([]string{"compose", "-p", d.project, "-f", d.composeFile}, arguments...)...)
	command.Stdout, command.Stderr = io.Discard, os.Stderr
	return command.Run()
}

// waitFor polls condition every 100 ms until it holds or timeout passes.
func waitFor(what string, timeout time.Duration, condition func() bool) error {
	deadline := time.Now().Add(timeout)
	for !condition() {
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for %s", what)
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}

func (d *demo) ready(id uint32) bool {
	response, err := d.http.Get("http://" + d.admin[id] + "/readyz")
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func (d *demo) waitReady(ids ...uint32) error {
	for _, id := range ids {
		if err := waitFor(fmt.Sprintf("broker %d readyz", id), 60*time.Second, func() bool { return d.ready(id) }); err != nil {
			return err
		}
	}
	return nil
}

// metric reads one partition gauge from a broker's /metrics, or -1.
func (d *demo) metric(id uint32, name, topic string, partition uint32) int64 {
	response, err := d.http.Get("http://" + d.admin[id] + "/metrics")
	if err != nil {
		return -1
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	pattern := regexp.MustCompile(fmt.Sprintf(`(?m)^mkfk_%s\{topic="%s",partition="%d"\} (\d+)$`, name, regexp.QuoteMeta(topic), partition))
	match := pattern.FindSubmatch(body)
	if match == nil {
		return -1
	}
	value, _ := strconv.ParseInt(string(match[1]), 10, 64)
	return value
}

// leader returns the broker that reports itself leader of topic/partition.
func (d *demo) leader(topic string, partition uint32) (uint32, error) {
	var leader uint32
	err := waitFor(fmt.Sprintf("a leader for %s/%d", topic, partition), 30*time.Second, func() bool {
		for id := range d.admin {
			if d.metric(id, "leader", topic, partition) == 1 && d.metric(id, "leader_ready", topic, partition) == 1 {
				leader = id
				return true
			}
		}
		return false
	})
	return leader, err
}

func (d *demo) metadata(id uint32) (protocol.MetadataResponseData, error) {
	request, _ := http.NewRequest(http.MethodGet, "http://"+d.client[id]+"/v1/metadata", nil)
	request.Header.Set("X-Request-ID", "demo-metadata")
	response, err := d.http.Do(request)
	if err != nil {
		return protocol.MetadataResponseData{}, err
	}
	defer response.Body.Close()
	var envelope protocol.MetadataResponse
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil || response.StatusCode != http.StatusOK {
		return protocol.MetadataResponseData{}, errors.Join(err, fmt.Errorf("metadata answered HTTP %d", response.StatusCode))
	}
	return envelope.Data, nil
}
