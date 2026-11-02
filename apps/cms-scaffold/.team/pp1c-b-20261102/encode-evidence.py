from pathlib import Path
import json,hashlib
p=Path.cwd();records=[]
for root in [p/'.team/pp1c-b-20261101',p/'.team/pp1c-b-20261102']:
 for f in sorted(root.rglob('*')):
  if not f.is_file() or f.name.endswith('.encoded.json') or f.suffix=='.class':continue
  data=f.read_bytes()
  try:text=data.decode('utf-8')
  except UnicodeError:continue
  if not ('\r' in text or text.endswith('\n\n') or any(line.rstrip(' \t')!=line for line in text.splitlines())):continue
  name=str(f.relative_to(p));encoded=Path(str(f)+'.encoded.json');item={'encoding':'utf-8','originalPath':name,'byteSize':len(data),'sha256':hashlib.sha256(data).hexdigest(),'text':text}
  encoded.write_text(json.dumps(item,ensure_ascii=False,indent=2)+'\n');again=json.loads(encoded.read_text());assert again['text'].encode()==data
  records.append({k:v for k,v in item.items()if k!='text'}|{'encodedPath':str(encoded.relative_to(p))})
(p/'.team/pp1c-b-20261102/artifact-encoding.json').write_text(json.dumps(records,indent=2)+'\n');print('Lossless generated-artifact wrappers',len(records))
