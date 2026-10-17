"""Bounded fresh-session snapshots within a cooperating same-UID boundary.

The trusted caller selects one existing flat session leaf directory before
spawn. No recursive search, credential lookup, provider execution or migration
is performed. Sealed bytes are evidence inputs, never execution authority.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

MAX_BYTES = 2 * 1024 * 1024
MAX_ENTRIES = 1024


class SessionSourceError(ValueError):
    """Source provenance or a sealed artifact cannot be established."""


def _json(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _identity(info):
    return dict(dev=info.st_dev,ino=info.st_ino)


@contextmanager
def _directory(path, *, private=False):
    path = Path(path)
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)):
        raise SessionSourceError('canonical absolute directory required')
    fd = os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            try:
                nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            except OSError as exc:
                raise SessionSourceError('unsafe directory path') from exc
            os.close(fd);fd=nxt
        info=os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_mode & (0o077 if private else 0o022):
            raise SessionSourceError('unsafe directory ownership/permissions')
        yield fd
    finally:
        os.close(fd)



@contextmanager
def _source_directory(path, private_ancestor):
    if not private_ancestor:
        with _directory(path) as fd:
            yield fd, None
        return
    path = Path(path)
    if (not path.is_absolute() or str(path) != os.path.normpath(str(path))
            or len(path.parts) > 64):
        raise SessionSourceError('canonical bounded absolute directory required')
    handles=[]
    fields=('st_dev','st_ino','st_uid','st_gid','st_mode')
    def walk():
        chain=[]; anchor=None; current=Path('/')
        fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        handles.append(fd)
        for part in (None, *path.parts[1:]):
            if part is not None:
                fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                handles.append(fd); current=current/part
            info=os.fstat(fd)
            if anchor is not None and info.st_uid != os.getuid():
                raise SessionSourceError('unowned private source descendant')
            if anchor is None:
                if info.st_uid == os.getuid() and not info.st_mode & 0o077:
                    anchor=dict(path=str(current),**_identity(info))
                elif info.st_uid != os.getuid() and not info.st_mode & 0o001:
                    raise SessionSourceError('untraversable source prefix')
            chain.append(tuple(getattr(info,k) for k in fields))
        if anchor is None:
            raise SessionSourceError('owned private source ancestor required')
        return fd, anchor, chain
    try:
        fd,anchor,before=walk()
        yield fd,anchor
        # Rewalk every component, not only the final pathname: an intermediate
        # replacement or permission change invalidates this capture.
        _,after_anchor,after=walk()
        if anchor != after_anchor or before != after:
            raise SessionSourceError('source ancestry changed')
    except OSError as exc:
        raise SessionSourceError('unsafe source ancestry') from exc
    finally:
        for fd in reversed(handles):os.close(fd)


def _entries(fd):
    names=[]
    with os.scandir(fd) as entries:
        for entry in entries:
            if len(names) >= MAX_ENTRIES:
                raise SessionSourceError('source directory entry limit')
            names.append(entry.name)
    return sorted(names)


def _read(fd, name, limit=MAX_BYTES, *, protected_source=False):
    if not isinstance(name,str) or not name or '/' in name or name in ('.','..'):
        raise SessionSourceError('invalid artifact name')
    handle=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
    try:
        before=os.fstat(handle)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_mode & (0o002 if protected_source else 0o077) or before.st_nlink != 1 or before.st_size > limit):
            raise SessionSourceError('unsafe or oversized source file')
        chunks=[];total=0
        while True:
            chunk=os.read(handle,min(65536,limit+1-total))
            if not chunk:break
            chunks.append(chunk);total+=len(chunk)
            if total>limit:raise SessionSourceError('source byte limit')
        after=os.fstat(handle)
        fields=('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_nlink','st_uid','st_gid')
        if any(getattr(before,k)!=getattr(after,k) for k in fields) or total!=after.st_size:
            raise SessionSourceError('source changed during read')
        current=os.stat(name,dir_fd=fd,follow_symlinks=False)
        if any(getattr(after,k)!=getattr(current,k) for k in fields):
            raise SessionSourceError('source path replaced during read')
        return b''.join(chunks),_identity(after)
    finally:os.close(handle)


def _exists(fd,name):
    try:os.stat(name,dir_fd=fd,follow_symlinks=False);return True
    except FileNotFoundError:return False


def _save(fd,name,raw,*,exclusive):
    temp='session-write-'+uuid.uuid4().hex
    target=name if exclusive else temp
    handle=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    with os.fdopen(handle,'wb') as stream:
        stream.write(raw);stream.flush();os.fsync(stream.fileno())
    if not exclusive:
        os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd)
    os.fsync(fd)


class CodexSessionSource:
    """Trusted explicit configuration; supported layout is a flat leaf only."""
    def __init__(self, root, *, private_ancestor=False):
        if type(private_ancestor) is not bool:
            raise SessionSourceError('explicit boolean source policy required')
        self.root=str(Path(root).absolute())
        self.private_ancestor=private_ancestor
        with _source_directory(self.root,self.private_ancestor):pass

    @classmethod
    def restore(cls, intent):
        # Reopening a seal must not require the mutable provider tree to exist.
        if type(intent) is not dict or type(intent.get('root')) is not str:
            raise SessionSourceError('invalid source root')
        obj=cls.__new__(cls)
        obj.root=intent['root']
        if intent.get('access_policy') not in ('strict-file-v1','owned-private-ancestor-v1'):
            raise SessionSourceError('invalid source access policy')
        obj.private_ancestor=intent['access_policy']=='owned-private-ancestor-v1'
        return obj

    def prepare(self, expected):
        required={'cwd','model','cli_version','prompt_sha256'}
        if (type(expected) is not dict or set(expected)!=required
                or any(type(v) is not str or not v or len(v)>4096 for v in expected.values())
                or not re.fullmatch('[0-9a-f]{64}',expected['prompt_sha256'])):
            raise SessionSourceError('invalid expected binding')
        with _source_directory(self.root,self.private_ancestor) as (fd,anchor):
            intent=dict(protocol='codex-session-source-v2',nonce=uuid.uuid4().hex,root=self.root,
                        root_identity=_identity(os.fstat(fd)),baseline=_entries(fd),
                        expected=dict(expected),private_anchor=anchor,
                        access_policy=('owned-private-ancestor-v1' if self.private_ancestor else 'strict-file-v1'))
        if len(_json(intent))>32768:raise SessionSourceError('source intent size limit')
        return intent

    def capture(self,intent,session_id,journal,*,binding_digest,closure_digest,expected_seal=None):
        """Seal once, then verify/replay only sealed bytes. Caller proves closure."""
        if (type(intent) is not dict or set(intent)!={'protocol','nonce','root','root_identity','baseline','expected','access_policy','private_anchor'}
                or intent['protocol']!='codex-session-source-v2' or intent['root']!=self.root
                or intent['access_policy']!=('owned-private-ancestor-v1' if self.private_ancestor else 'strict-file-v1')
                or (not self.private_ancestor and intent['private_anchor'] is not None)
                or not isinstance(session_id,str)
                or not re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',session_id)
                or any(not isinstance(v,str) or not re.fullmatch('[0-9a-f]{64}',v)
                       for v in (binding_digest,closure_digest))):
            raise SessionSourceError('invalid source binding')
        key=_hash(_json(intent))
        manifest_name='session-seal-'+key+'.json';blob_name='session-raw-'+key+'.jsonl'
        expected=dict(protocol='codex-session-v1',binding_digest=binding_digest,
                      intent_digest=_hash(_json(intent)),closure_digest=closure_digest,
                      session_id=session_id,blob=blob_name)
        with _directory(journal,private=True) as destination:
            if _exists(destination,manifest_name):
                try:
                    from .native_events import _parse_line
                    metadata,_=_read(destination,manifest_name,65536)
                    manifest=_parse_line(metadata.decode('utf-8'))
                    if expected_seal is not None and manifest != expected_seal:
                        raise SessionSourceError('committed seal mismatch')
                    if (set(manifest)!=set(expected)|{'sha256','size','source_name','source_identity'}
                            or any(manifest.get(k)!=v for k,v in expected.items())):
                        raise SessionSourceError('seal binding mismatch')
                    raw,_=_read(destination,blob_name)
                    if type(manifest['size']) is not int or len(raw)!=manifest['size'] or _hash(raw)!=manifest['sha256']:
                        raise SessionSourceError('seal content mismatch')
                    # Reaffirm durability before publishing a recovered seal.
                    os.fsync(destination)
                    return dict(raw=raw,manifest=manifest,manifest_name=manifest_name)
                except (ValueError,KeyError,UnicodeError,OSError) as exc:
                    raise SessionSourceError('invalid sealed source') from exc
            if expected_seal is not None:
                raise SessionSourceError('committed seal missing')
            if _exists(destination,blob_name):
                raise SessionSourceError('partial source seal; no recapture')
            with _source_directory(self.root,self.private_ancestor) as (source,anchor):
                if anchor != intent['private_anchor']:
                    raise SessionSourceError('source private anchor drift')
                if _identity(os.fstat(source))!=intent['root_identity']:
                    raise SessionSourceError('source root identity drift')
                names=_entries(source)
                matches=[n for n in names if n.startswith('rollout-') and n.endswith('-'+session_id+'.jsonl')]
                if len(matches)!=1 or matches[0] in intent['baseline']:
                    raise SessionSourceError('source not uniquely fresh')
                name=matches[0];raw,identity=_read(source,name,protected_source=self.private_ancestor)
                # Two bounded reads detect mutation during capture; this is not
                # an event completeness proof or hostile same-UID isolation.
                second,identity2=_read(source,name,protected_source=self.private_ancestor)
                if raw!=second or identity!=identity2:
                    raise SessionSourceError('source not stable')
                if _identity(os.stat(self.root,follow_symlinks=False))!=intent['root_identity']:
                    raise SessionSourceError('source root replaced')
            manifest=dict(expected,sha256=_hash(raw),size=len(raw),source_name=name,source_identity=identity)
            _save(destination,blob_name,raw,exclusive=True)
            _save(destination,manifest_name,_json(manifest),exclusive=False)
            return dict(raw=raw,manifest=manifest,manifest_name=manifest_name)
