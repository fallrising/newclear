"""Submit one visible-UI command to the owned exploration recorder (stdlib)."""
import json
from pathlib import Path
import sys
import time
import uuid


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: ui_command.py CONTROL_DIR 'JSON_COMMAND'")
    control = Path(sys.argv[1])
    command = json.loads(sys.argv[2])
    request_id = str(uuid.uuid4())
    path = control / 'request.json'
    temp = control / (request_id + '.tmp')
    temp.write_text(json.dumps({'id': request_id, 'command': command}))
    temp.replace(path)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            result = json.loads((control / 'response.json').read_text())
            if result.get('id') == request_id:
                print(json.dumps(result, ensure_ascii=False))
                return
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        time.sleep(0.1)
    raise SystemExit('Recorder did not reply within 30 seconds; do not blindly resend actions.')


if __name__ == '__main__':
    main()
