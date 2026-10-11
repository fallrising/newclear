# Command deadline after output EOF

A command can close stdout/stderr while continuing to run a paid adapter. Output EOF is not process termination. The approved execution deadline must cover both output collection and waiting for process exit, using the same monotonic deadline.

Acceptance: a local fake command that closes both descriptors then sleeps past the limit returns timeout evidence and exit 124; a fast command closing descriptors retains its real exit status. Timeout kills the owned process group and reaps the direct child. Existing redaction, output limits and overflow precedence remain intact. Tests use only local Python subprocesses.

After EOF, wait only for the original remaining deadline. If it expires, reuse the existing process-group cleanup. Never grant a fresh timeout or retry the command. This bounds local execution; it cannot cancel work already accepted or billed by an external provider, and does not implement a monetary budget or production deployment.

Verification: focused execution unit/integration tests, the repository's check script and full offline Python tests, followed by required CI and independent review. No dependency, provider configuration or protected policy/workflow change is needed.
