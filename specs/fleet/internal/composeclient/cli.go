package composeclient

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// CLI shells out to docker compose v2. The agent never execs docker outside this type.
type CLI struct {
	Docker           string
	AgentComposeFile string
}

func (c *CLI) bin() string {
	if c.Docker != "" {
		return c.Docker
	}
	return "docker"
}

func (c *CLI) run(ctx context.Context, stdin string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, c.bin(), args...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	if err != nil {
		return out.String(), fmt.Errorf("docker %s: %w (%s)", strings.Join(args, " "), err, strings.TrimSpace(out.String()))
	}
	return out.String(), nil
}

func (c *CLI) Login(ctx context.Context, registry, username, password string) error {
	_, err := c.run(ctx, password, "login", registry, "-u", username, "--password-stdin")
	return err
}

func (c *CLI) Pull(ctx context.Context, project Project, composeFile string) error {
	if err := guard(project); err != nil {
		return err
	}
	_, err := c.run(ctx, "", "compose", "-p", string(project), "-f", composeFile, "pull")
	return err
}

func (c *CLI) Up(ctx context.Context, project Project, composeFile string, opts UpOpts) error {
	if err := guard(project); err != nil {
		return err
	}
	args := []string{"compose", "-p", string(project), "-f", composeFile, "up", "-d", "--no-build"}
	if opts.ForceRecreate {
		args = append(args, "--force-recreate")
	}
	_, err := c.run(ctx, "", args...)
	return err
}

func (c *CLI) Start(ctx context.Context, project Project, composeFile string) error {
	if err := guard(project); err != nil {
		return err
	}
	_, err := c.run(ctx, "", "compose", "-p", string(project), "-f", composeFile, "start")
	return err
}

func (c *CLI) Stop(ctx context.Context, project Project, composeFile string) error {
	if err := guard(project); err != nil {
		return err
	}
	_, err := c.run(ctx, "", "compose", "-p", string(project), "-f", composeFile, "stop")
	return err
}

func (c *CLI) Down(ctx context.Context, project Project, composeFile string, opts DownOpts) error {
	if err := guard(project); err != nil {
		return err
	}
	args := []string{"compose", "-p", string(project), "-f", composeFile, "down"}
	if opts.PurgeVolumes {
		args = append(args, "-v")
	}
	_, err := c.run(ctx, "", args...)
	return err
}

func (c *CLI) Ps(ctx context.Context, project Project, composeFile string) (PsInfo, error) {
	if err := guard(project); err != nil {
		return PsInfo{}, err
	}
	out, err := c.run(ctx, "", "compose", "-p", string(project), "-f", composeFile, "ps", "-q", "--status", "running")
	if err != nil {
		return PsInfo{}, err
	}
	id := strings.TrimSpace(out)
	info := PsInfo{Running: id != "", Names: nil}
	if id != "" {
		info.ContainerID = strings.Split(id, "\n")[0]
	}
	return info, nil
}

func (c *CLI) UpSidecar(ctx context.Context) error {
	file := c.AgentComposeFile
	if file == "" {
		file = os.Getenv("FLEET_AGENT_COMPOSE_FILE")
	}
	if file == "" {
		file = "/usr/local/share/fleet/agent-stack.yml"
	}
	_, err := c.run(ctx, "", "compose", "-p", "fleet-agent", "-f", file, "--profile", "tunnel",
		"up", "-d", "--no-deps", "--force-recreate", "cloudflared")
	return err
}
