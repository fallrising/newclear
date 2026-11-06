import json, os, pathlib, pty, select, signal, sys, termios, time

# Root supplies private memory JSON on stdin; it is never stored or logged.
data = json.loads(sys.stdin.buffer.read(16385))
assert set(data) == {'runId', 'operationId', 'username', 'password'}
password = bytearray(data.pop('password').encode())
root = pathlib.Path.cwd()
node = '/home/ckc/.local/node-v24.18.0/bin/node'
args = [node, 'scripts/local/maintenance.mjs', '--run-id', data['runId'], '--java-bin',
        '/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8/bin/java', '--jar',
        str(root / 'services/cms-api/build/libs/cms-api-0.1.0-SNAPSHOT.jar'), '--', 'fresh-init',
        '--username', data['username'], '--display-name', 'PP1c Integration Admin',
        '--target-id', 'pp1-local:' + data['runId'], '--operation-id', data['operationId'], '--confirm', 'FRESH_INIT']
child, fd = pty.fork()
if child == 0:
    os.execv(node, args)
buffer = bytearray()
sent = 0
status = None
failure = None
try:
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .2)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                chunk = b''
            buffer.extend(chunk)
            if len(buffer) > 1048576 or password in buffer:
                raise RuntimeError('PRIVATE_OUTPUT_REJECTED')
            prompt = [b'New password: ', b'Confirm password: '][min(sent, 1)]
            if sent < 2 and prompt in buffer:
                if termios.tcgetattr(fd)[3] & termios.ECHO:
                    raise RuntimeError('PTY_ECHO_UNSAFE')
                os.write(fd, password + b'\n')
                sent += 1
                buffer[:] = b'\0' * len(buffer)
                buffer.clear()
        ended, value = os.waitpid(child, os.WNOHANG)
        if ended:
            status = os.waitstatus_to_exitcode(value)
            child = None
            break
    if status is None:
        raise RuntimeError('PTY_TIMEOUT')
    if status != 0 or sent != 2:
        raise RuntimeError('BOOTSTRAP_FAILED')
except Exception as error:
    failure = str(error) if isinstance(error, RuntimeError) else 'BOOTSTRAP_FAILED'
finally:
    os.close(fd)
    if child:
        os.kill(child, signal.SIGTERM)
        os.waitpid(child, 0)
    password[:] = b'\0' * len(password)
    buffer[:] = b'\0' * len(buffer)
print(json.dumps({'exitCode': status, 'prompts': sent, 'success': failure is None, 'code': failure}))
if failure:
    raise SystemExit(1)
