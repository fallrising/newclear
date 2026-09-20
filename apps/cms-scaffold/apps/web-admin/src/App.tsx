import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, Card, Field, Input, Page } from "@cms/ui";
import { ApiRequestError, type ContentType, type Me, type Principal } from "@cms/api";
import { api } from "./api";

function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);
  return me;
}

function Login() {
  const [username, setUsername] = useState("seed-admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.csrf();
      const me = await api.login(username, password);
      if (!me.surfaces.admin) {
        setError("這個帳號不能進 Admin center。");
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "登入失敗");
    }
  }
  return (
    <Page title="Admin 登入" eyebrow="web-admin">
      <form className="max-w-sm" onSubmit={onSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="帳號"><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="密碼"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit">登入</Button>
      </form>
    </Page>
  );
}

function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  return (
    <div>
      <nav className="border-b border-[var(--line)] px-6 py-3 text-sm">
        <div className="mx-auto flex max-w-5xl gap-4">
          <Link to="/">Admin</Link>
          <Link to="/types">類型</Link>
          <Link to="/users">使用者</Link>
          <button className="ml-auto" onClick={async () => { await api.csrf(); await api.logout(); window.location.assign("/login"); }}>
            登出 {me.principal.username}
          </button>
        </div>
      </nav>
      {children}
    </div>
  );
}

function Home() {
  return (
    <Page title="治理台" eyebrow="Admin center">
      <p className="text-[var(--muted)]">類型啟停、帳號列表。日常編輯請用 Back office。</p>
    </Page>
  );
}

function Types() {
  const [items, setItems] = useState<ContentType[]>([]);
  const [error, setError] = useState("");
  async function load() {
    try {
      setItems((await api.adminTypes()).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    }
  }
  useEffect(() => { load(); }, []);
  async function toggle(type: ContentType) {
    try {
      await api.csrf();
      if (type.enabled === false) await api.enableType(type.key);
      else await api.disableType(type.key);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失敗");
    }
  }
  return (
    <Page title="內容類型" eyebrow="Registry">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {items.length === 0 && !error ? <Banner>尚未載入類型種子。</Banner> : null}
      <div className="space-y-2">
        {items.map((type) => (
          <Card key={type.key}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong>{type.displayName}</strong>
                <span className="ml-2 text-[var(--muted)]">{type.key}</span>
              </div>
              <Button type="button" onClick={() => toggle(type)}>{type.enabled === false ? "啟用" : "停用"}</Button>
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function Users() {
  const [items, setItems] = useState<Principal[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api.principals().then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);
  return (
    <Page title="使用者" eyebrow="Identity">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id}><Card>{p.username} · {p.displayName} · {p.status}</Card></li>
        ))}
      </ul>
    </Page>
  );
}

function Forbidden() {
  return <Page title="沒有權限"><Banner tone="danger">已登入，但不是 admin surface。請用 seed-admin 從本面登入。</Banner></Page>;
}

export default function App() {
  const me = useMe();
  if (me === undefined) return <Page title="Admin"><Banner>檢查 session…</Banner></Page>;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          !me ? <Navigate to="/login" replace /> : !me.surfaces.admin ? <Forbidden /> : (
            <Shell me={me}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/types" element={<Types />} />
                <Route path="/users" element={<Users />} />
              </Routes>
            </Shell>
          )
        }
      />
    </Routes>
  );
}
