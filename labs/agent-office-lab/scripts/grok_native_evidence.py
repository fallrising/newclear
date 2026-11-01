"""Read only the current session's explicit model selection from native Grok logs."""
import json

def selected_model(log, session):
    if not log.is_file() or log.is_symlink() or log.stat().st_size>5*1024*1024:return None
    model=None
    for line in log.read_text().splitlines():
        try:row=json.loads(line)
        except ValueError:continue
        if row.get('ver')=='1.0.70' and row.get('sid')==session and row.get('msg')=='model changed':
            model=row.get('ctx',{}).get('model')
    return model
