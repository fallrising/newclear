import { Link, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, Card, Field, Input, Page } from "@cms/ui";
import { ApiRequestError, type PublicEntry } from "@cms/api";
import { api } from "./api";

function mediaUrl(value: unknown): string | undefined {
  if (value && typeof value === "object" && "variants" in value) {
    const variants = (value as { variants?: Record<string, { url?: string }> }).variants;
    return variants?.thumbnail?.url || variants?.web?.url;
  }
  return undefined;
}

function abs(url?: string) {
  if (!url) return undefined;
  return url.startsWith("http") ? url : api.base + url;
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="border-b border-[var(--line)] px-6 py-3 text-sm">
        <div className="mx-auto flex max-w-5xl gap-4">
          <Link to="/">CMS</Link>
          <Link to="/album">相簿</Link>
          <Link to="/clinic">診所</Link>
          <Link to="/projects">專案</Link>
          <Link to="/login" className="ml-auto">登入</Link>
        </div>
      </nav>
      {children}
    </div>
  );
}

function Home() {
  return (
    <Page title="CMS Scaffold" eyebrow="Front office">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><Link to="/album"><h2 className="text-xl">個人相簿</h2><p className="text-[var(--muted)]">公開相簿與相片。</p></Link></Card>
        <Card><Link to="/clinic"><h2 className="text-xl">Pet clinic</h2><p className="text-[var(--muted)]">診所介紹與已發布獸醫。</p></Link></Card>
        <Card><Link to="/projects"><h2 className="text-xl">專案</h2><p className="text-[var(--muted)]">公開專案說明與里程碑。</p></Link></Card>
      </div>
    </Page>
  );
}

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [search] = useSearchParams();
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.csrf();
      await api.login(username, password);
      window.location.assign(search.get("next") || "/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "登入失敗");
    }
  }
  return (
    <Page title="登入" eyebrow="Front">
      <form className="max-w-sm" onSubmit={onSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="帳號"><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="密碼"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit">登入</Button>
      </form>
    </Page>
  );
}

function AlbumHome() {
  const [items, setItems] = useState<PublicEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.publicEntries("album").then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);
  return (
    <Page title="相簿" eyebrow="Album" actions={<Link to="/album/albums">全部相簿</Link>}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {items.length === 0 && !error ? <Banner>還沒有公開相簿。發布後會出現在這裡。</Banner> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((album) => {
          const src = abs(mediaUrl(album.payload.cover));
          return (
            <Card key={album.id}>
              <Link to={`/album/albums/${album.slug || album.id}`}>
                {src ? <img src={src} alt="" className="mb-3 h-40 w-full rounded-lg object-cover" /> : null}
                <h2 className="text-xl">{album.title || album.slug}</h2>
                <p className="text-[var(--muted)]">{String(album.payload.description || "")}</p>
              </Link>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}

function AlbumDetail() {
  const { slug = "" } = useParams();
  const [album, setAlbum] = useState<PublicEntry | null>(null);
  const [photos, setPhotos] = useState<PublicEntry[]>([]);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.publicBySlug("album", slug)
      .then(async (entry) => {
        setAlbum(entry);
        const list = await api.publicEntries("photo", { [`ref.album`]: entry.id });
        setPhotos([...list.items].sort((a, b) => Number(a.payload.sortOrder || 0) - Number(b.payload.sortOrder || 0)));
      })
      .catch(() => setMissing(true));
  }, [slug]);
  if (missing) return <Page title="找不到相簿"><Banner>這本相簿不存在或尚未發布。</Banner></Page>;
  if (!album) return <Page title="載入中…"><Banner>讀取公開內容。</Banner></Page>;
  return (
    <Page title={String(album.title || slug)} eyebrow="Album">
      <p className="mb-6 text-[var(--muted)]">{String(album.payload.description || "")}</p>
      {photos.length === 0 ? <Banner>這本相簿還沒有公開照片。</Banner> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {photos.map((photo) => {
          const src = abs(mediaUrl(photo.payload.media));
          return (
            <Link key={photo.id} to={`/album/photos/${photo.slug || photo.id}`}>
              {src ? <img src={src} alt={String(photo.payload.caption || photo.title || "")} className="h-40 w-full rounded-lg object-cover" /> : <Card>{photo.title}</Card>}
              {photo.payload.caption ? <p className="mt-1 text-sm text-[var(--muted)]">{String(photo.payload.caption)}</p> : null}
            </Link>
          );
        })}
      </div>
    </Page>
  );
}

function PhotoPage() {
  const { slug = "" } = useParams();
  const [photo, setPhoto] = useState<PublicEntry | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.publicBySlug("photo", slug)
      .catch(() => api.publicById("photo", slug))
      .then(setPhoto)
      .catch(() => setMissing(true));
  }, [slug]);
  if (missing) return <Page title="找不到相片"><Banner>未發布或不存在。</Banner></Page>;
  if (!photo) return <Page title="載入中…"><Banner>讀取相片。</Banner></Page>;
  const src = abs(mediaUrl(photo.payload.media));
  return (
    <Page title={String(photo.title || "Photo")} eyebrow="Album">
      {src ? <img src={src} alt={String(photo.payload.caption || photo.title || "photo")} className="max-h-[80vh] w-full rounded-xl object-contain" /> : <Banner>沒有公開圖片。</Banner>}
      {photo.payload.caption ? <p className="mt-4 text-[var(--muted)]">{String(photo.payload.caption)}</p> : null}
    </Page>
  );
}

function ClinicHome() {
  const [profile, setProfile] = useState<PublicEntry | null | undefined>(undefined);
  const [vets, setVets] = useState<PublicEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.publicBySlug("clinic_profile", "home").then(setProfile).catch(() => setProfile(null));
    api.publicEntries("vet").then((r) => setVets(r.items)).catch((e) => setError(e.message));
  }, []);
  return (
    <Page title={String(profile?.title || "Pet clinic")} eyebrow="Clinic">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {profile ? (
        <div className="mb-8">
          <p className="text-[var(--muted)]">{String(profile.payload.intro || "")}</p>
          {profile.payload.address ? <p className="mt-2">{String(profile.payload.address)}</p> : null}
          {profile.payload.hours ? <p className="text-sm text-[var(--muted)]">{String(profile.payload.hours)}</p> : null}
        </div>
      ) : profile === null ? (
        <Banner>還沒有公開的診所介紹。</Banner>
      ) : (
        <Banner>讀取診所介紹。</Banner>
      )}
      <h2 className="mb-3 text-lg">獸醫</h2>
      {vets.length === 0 ? <Banner>沒有已發布的獸醫。</Banner> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {vets.map((vet) => (
          <Card key={vet.id}>
            <h3 className="text-xl">{vet.title}</h3>
            <p className="text-[var(--muted)]">{String(vet.payload.specialty || "")}</p>
            <p>{String(vet.payload.bio || "")}</p>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function ProjectsHome() {
  const [items, setItems] = useState<PublicEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.publicEntries("project").then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);
  return (
    <Page title="專案" eyebrow="Projects">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {items.length === 0 && !error ? <Banner>還沒有公開專案。</Banner> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((project) => (
          <Card key={project.id}>
            <Link to={`/projects/${project.slug || project.id}`}>
              <h2 className="text-xl">{project.title}</h2>
              <p className="text-[var(--muted)]">{String(project.payload.summary || "")}</p>
            </Link>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function ProjectDetail() {
  const { slug = "" } = useParams();
  const [project, setProject] = useState<PublicEntry | null>(null);
  const [milestones, setMilestones] = useState<PublicEntry[]>([]);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.publicBySlug("project", slug)
      .then(async (entry) => {
        setProject(entry);
        const list = await api.publicEntries("milestone", { [`ref.project`]: entry.id });
        setMilestones([...list.items].sort((a, b) => Number(a.payload.sortOrder || 0) - Number(b.payload.sortOrder || 0)));
      })
      .catch(() => setMissing(true));
  }, [slug]);
  if (missing) return <Page title="找不到專案"><Banner>這份專案不存在、未發布，或未公開。</Banner></Page>;
  if (!project) return <Page title="載入中…"><Banner>讀取公開專案。</Banner></Page>;
  return (
    <Page title={String(project.title || slug)} eyebrow="Projects">
      <p className="mb-6 text-[var(--muted)]">{String(project.payload.summary || "")}</p>
      <h2 className="mb-3 text-lg">里程碑</h2>
      {milestones.length === 0 ? <Banner>還沒有公開里程碑。</Banner> : null}
      <ul className="space-y-2">
        {milestones.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <span className="text-[var(--muted)]"> · {String(item.payload.status || "")}</span>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/album" element={<AlbumHome />} />
        <Route path="/album/albums" element={<AlbumHome />} />
        <Route path="/album/albums/:slug" element={<AlbumDetail />} />
        <Route path="/album/photos/:slug" element={<PhotoPage />} />
        <Route path="/clinic" element={<ClinicHome />} />
        <Route path="/projects" element={<ProjectsHome />} />
        <Route path="/projects/:slug" element={<ProjectDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
