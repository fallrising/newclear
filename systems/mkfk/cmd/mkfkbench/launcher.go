package main

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// endpoints are one broker's listener addresses.
type endpoints struct{ client, peer, admin string }

// launcher runs brokers for one benchmark configuration at a time.
type launcher interface {
	addresses(id uint32) endpoints
	install(topology []byte) error
	start(id uint32, fresh bool) error
	stop(id uint32) error
	machine(id uint32) string
}

// localLauncher runs brokers as child processes on loopback.
type localLauncher struct {
	binary, root string
	ports        map[uint32]endpoints
	running      map[uint32]*exec.Cmd
}

func newLocalLauncher(binary, root string) (*localLauncher, error) {
	l := &localLauncher{binary: binary, root: root, ports: map[uint32]endpoints{}, running: map[uint32]*exec.Cmd{}}
	for id := uint32(1); id <= 3; id++ {
		var addresses [3]string
		for index := range addresses {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				return nil, err
			}
			addresses[index] = listener.Addr().String()
			_ = listener.Close()
		}
		l.ports[id] = endpoints{client: addresses[0], peer: addresses[1], admin: addresses[2]}
	}
	return l, os.MkdirAll(root, 0o700)
}

func (l *localLauncher) addresses(id uint32) endpoints { return l.ports[id] }

func (l *localLauncher) install(topology []byte) error {
	return os.WriteFile(filepath.Join(l.root, "cluster.json"), topology, 0o600)
}

func (l *localLauncher) start(id uint32, fresh bool) error {
	dataDir := filepath.Join(l.root, fmt.Sprintf("node-%d", id))
	node := []string{"--data-dir", dataDir, "--node-id", strconv.Itoa(int(id)), "--cluster-json", filepath.Join(l.root, "cluster.json")}
	if fresh {
		if err := os.RemoveAll(dataDir); err != nil {
			return err
		}
		if output, err := exec.Command(l.binary, append([]string{"format"}, node...)...).CombinedOutput(); err != nil {
			return fmt.Errorf("format broker %d: %v: %s", id, err, output)
		}
	}
	command := exec.Command(l.binary, append([]string{"serve"}, node...)...)
	log, err := os.OpenFile(filepath.Join(l.root, fmt.Sprintf("broker-%d.log", id)), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	command.Stdout, command.Stderr = log, log
	if err := command.Start(); err != nil {
		return err
	}
	l.running[id] = command
	return nil
}

func (l *localLauncher) stop(id uint32) error {
	command := l.running[id]
	if command == nil {
		return nil
	}
	delete(l.running, id)
	_ = command.Process.Signal(syscall.SIGTERM)
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(20 * time.Second):
		_ = command.Process.Kill()
		return errors.New("broker did not stop within 20s")
	}
}

func (l *localLauncher) machine(uint32) string {
	return describeMachine(exec.Command("sh", "-c", machineScript(l.root)))
}

// sshLauncher runs one broker per host over ssh. Listener addresses use the
// given private-network IPs; hosts and IPs never enter the results.
type sshLauncher struct {
	hosts, ips []string
	command    []string
	dir        string
	pids       map[uint32]string
}

func newSSHLauncher(hosts, ips, command []string, dir, binary string) (*sshLauncher, error) {
	if len(hosts) != 3 || len(ips) != 3 {
		return nil, errors.New("ssh launcher needs three hosts and three private IPs")
	}
	l := &sshLauncher{hosts: hosts, ips: ips, command: command, dir: dir, pids: map[uint32]string{}}
	program, err := os.ReadFile(binary)
	if err != nil {
		return nil, err
	}
	for id := uint32(1); id <= 3; id++ {
		script := fmt.Sprintf("mkdir -p %[1]s && cat > %[1]s/mkfk.new && chmod 0755 %[1]s/mkfk.new && mv %[1]s/mkfk.new %[1]s/mkfk", dir)
		if _, err := l.ssh(id, program, script); err != nil {
			return nil, err
		}
	}
	return l, nil
}

// ssh runs script on a host. ssh exits 255 only when the connection
// itself failed, before the script ran, so that case is retried. Errors
// name the node, never the host.
func (l *sshLauncher) ssh(id uint32, stdin []byte, script string) (string, error) {
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		command := l.remote(id, script)
		command.Stdin = bytes.NewReader(stdin)
		var output []byte
		output, err = command.CombinedOutput()
		if err == nil {
			return strings.TrimSpace(string(output)), nil
		}
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 255 {
			return "", fmt.Errorf("node-%d: script failed: %v", id, err)
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
	}
	return "", fmt.Errorf("node-%d: ssh connection kept failing: %v", id, err)
}

func (l *sshLauncher) addresses(id uint32) endpoints {
	ip := l.ips[id-1]
	return endpoints{
		client: net.JoinHostPort(ip, strconv.Itoa(19090+int(id))), peer: net.JoinHostPort(ip, strconv.Itoa(19190+int(id))),
		admin: net.JoinHostPort(ip, strconv.Itoa(19290+int(id))),
	}
}

func (l *sshLauncher) install(topology []byte) error {
	for id := uint32(1); id <= 3; id++ {
		if _, err := l.ssh(id, topology, fmt.Sprintf("cat > %s/cluster.json", l.dir)); err != nil {
			return err
		}
	}
	return nil
}

func (l *sshLauncher) start(id uint32, fresh bool) error {
	node := fmt.Sprintf("--data-dir %[1]s/node-%[2]d --node-id %[2]d --cluster-json %[1]s/cluster.json", l.dir, id)
	script := "set -e; "
	if fresh {
		script += fmt.Sprintf("rm -rf %[1]s/node-%[2]d; %[1]s/mkfk format %[3]s; ", l.dir, id, node)
	}
	// Only the broker itself runs in the background, with every stream
	// redirected, so the ssh session returns as soon as it has started.
	script += fmt.Sprintf("nohup %[1]s/mkfk serve %[2]s --allow-insecure-bind >>%[1]s/broker-%[3]d.log 2>&1 </dev/null & echo $!", l.dir, node, id)
	pid, err := l.ssh(id, nil, script)
	if err == nil {
		l.pids[id] = pid
	}
	return err
}

func (l *sshLauncher) stop(id uint32) error {
	pid := l.pids[id]
	if pid == "" {
		return nil
	}
	delete(l.pids, id)
	_, err := l.ssh(id, nil, fmt.Sprintf("kill -TERM %[1]s; for i in $(seq 1 200); do kill -0 %[1]s 2>/dev/null || exit 0; sleep 0.1; done; kill -KILL %[1]s", pid))
	return err
}

func (l *sshLauncher) machine(id uint32) string {
	return describeMachine(l.remote(id, machineScript(l.dir)))
}

func (l *sshLauncher) remote(id uint32, script string) *exec.Cmd {
	arguments := append(append([]string(nil), l.command[1:]...), l.hosts[id-1], script)
	return exec.Command(l.command[0], arguments...)
}

func machineScript(dir string) string {
	return fmt.Sprintf(`echo "$(nproc) vCPU, $(awk '/MemTotal/{printf "%%.1f GiB", $2/1048576}' /proc/meminfo) RAM,`+
		` $(lscpu | sed -n 's/^Model name: *//p'), kernel $(uname -r), $(df -T %s | awk 'NR==2{print $2}') on $(lsblk -dno ROTA 2>/dev/null | head -1 | tr -d ' ' | sed 's/^0$/non-rotational disk/;s/^1$/disk reported as rotational/')"`, dir)
}

func describeMachine(command *exec.Cmd) string {
	output, err := command.Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}
