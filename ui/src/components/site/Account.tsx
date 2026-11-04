"use client";
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { api, field, Label, Pill, primary, quiet, Side, type Rec } from "./kit";

/* Who is using the app. Until the first account exists the computer running it opens without a login, so a laptop presenting it needs nothing set up. Once one exists everyone signs in. The server decides what each person may do: these screens only say so. */

const Me = createContext<Rec | null>(null);
export const useMe = () => useContext(Me);

function SignIn({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try { await api("/api/auth/login", f); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-[#111820] p-4">
      <form onSubmit={send} className="w-full max-w-[360px] space-y-3 rounded-xl border border-white/10 bg-[#1c2733] p-5 text-[13px]">
        <div><span role="img" aria-label="NorthTeak" className="logo-full mb-2 h-8 w-[164px] text-white" /><p className="text-[#abb3bf]">Sign in to your project.</p></div>
        <label className="block"><Label>Email</Label><input autoFocus type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={field} /></label>
        <label className="block"><Label>Password</Label><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={field} /></label>
        {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
        <button disabled={busy || !f.email || !f.password} className={`${primary} w-full !py-2 !text-[13px]`}>Sign in</button>
      </form>
    </div>
  );
}

/** Everything that needs a person goes inside this. It stays out of the way until accounts exist. */
export function Gate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Rec | null>(null);
  const read = useCallback(() => { api("/api/auth/me").then(setMe).catch(() => setMe({ enabled: false, local: true, can: [], offline: true })); }, []);
  useEffect(() => {
    read();
    window.addEventListener("signed-out", read);
    window.addEventListener("account-changed", read);
    return () => { window.removeEventListener("signed-out", read); window.removeEventListener("account-changed", read); };
  }, [read]);
  if (!me) return null;
  if (me.enabled && !me.user) return <SignIn onDone={read} />;
  if (!me.enabled && !me.local) return <div className="fixed inset-0 flex items-center justify-center bg-[#111820] p-6 text-center text-[13px] leading-relaxed text-[#abb3bf]"><p className="max-w-[420px]">This app opens only on the computer running it until accounts are set up. Create the first account there, under Team, and then sign in from here.</p></div>;
  return <Me.Provider value={me}>{children}</Me.Provider>;
}

function Matrix({ me }: { me: Rec }) {
  return (
    <div className="space-y-2">
      <Label>What each role can do</Label>
      {(me.roles as Rec[]).map((r) => (
        <div key={r.key} className="rounded-lg border border-white/10 p-2">
          <p className="font-semibold text-white">{r.name}</p>
          <p className="text-[11.5px] leading-snug text-[#abb3bf]">{(r.can as string[]).length ? (r.can as string[]).map((c) => me.abilities[c]).join(". ") : "Reads everything, changes nothing"}.</p>
        </div>
      ))}
    </div>
  );
}

function FirstAccount({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  return (
    <div className="space-y-2">
      <p className="leading-snug text-[#d3d8de]">Accounts are off. This computer opens without a login, and every other device is refused.</p>
      <p className="leading-snug text-[#abb3bf]">Make the first account when other people need in. It becomes the administrator, and from then on everyone signs in, including you. Other devices can reach the app after restart-screens.bat is run again.</p>
      <label className="block"><Label>Your name</Label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} /></label>
      <label className="block"><Label>Email</Label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={field} /></label>
      <label className="block"><Label>Password, at least 8 characters</Label><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={field} /></label>
      {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
      <button disabled={!f.name.trim() || !f.email.trim() || f.password.length < 8} onClick={async () => { try { await api("/api/auth/first", f); onDone(); } catch (x) { setErr((x as Error).message); } }} className={`${primary} w-full`}>Create the first account</button>
    </div>
  );
}

function People({ me }: { me: Rec }) {
  const [rows, setRows] = useState<Rec[]>([]);
  const [err, setErr] = useState("");
  const blank = { name: "", email: "", role: "site", password: "" };
  const [f, setF] = useState(blank);
  const read = useCallback(() => { api("/api/auth/users").then((r) => setRows(r.users as Rec[])).catch((x) => setErr((x as Error).message)); }, []);
  useEffect(read, [read]);
  const change = async (id: number, body: Rec) => { setErr(""); try { await api(`/api/auth/users/${id}`, body); read(); } catch (x) { setErr((x as Error).message); } };
  return (
    <div className="space-y-2">
      <Label>The team</Label>
      {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
      <ul className="divide-y divide-white/[.06]">
        {rows.map((u) => (
          <li key={u.id} className="space-y-1 py-1.5">
            <p className="flex items-center gap-2"><span className={`min-w-0 flex-1 truncate ${u.active ? "text-white" : "text-[#8f99a8] line-through"}`}>{u.name}</span><button onClick={() => void change(u.id, { active: !u.active })} className={quiet}>{u.active ? "Remove access" : "Give access back"}</button></p>
            <p className="flex items-center gap-2 text-[11.5px] text-[#8f99a8]"><span className="min-w-0 flex-1 truncate">{u.email}</span><select aria-label={`Role of ${u.name}`} value={u.role} onChange={(e) => void change(u.id, { role: e.target.value })} className="rounded border border-white/15 bg-black/20 px-1 py-0.5 text-[11.5px] text-white">{(me.roles as Rec[]).map((r) => <option key={r.key} value={r.key} className="bg-[#1c2733]">{r.name}</option>)}</select></p>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 rounded-lg bg-white/[.03] p-2.5">
        <Label>Add a person</Label>
        <input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} />
        <input aria-label="Email" placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={field} />
        <select aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className={field}>{(me.roles as Rec[]).map((r) => <option key={r.key} value={r.key} className="bg-[#1c2733]">{r.name}</option>)}</select>
        <input aria-label="First password" placeholder="First password, at least 8 characters" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={field} />
        <button disabled={!f.name.trim() || !f.email.trim() || f.password.length < 8} onClick={async () => { setErr(""); try { await api("/api/auth/users", f); setF(blank); read(); } catch (x) { setErr((x as Error).message); } }} className={`${primary} w-full`}>Add them</button>
      </div>
    </div>
  );
}

function Password({ onDone }: { onDone: (note: string) => void }) {
  const [f, setF] = useState({ old: "", new: "" });
  const [err, setErr] = useState("");
  return (
    <details className="rounded border border-white/10"><summary className="cursor-pointer px-2 py-1.5 text-[11.5px] text-[#d3d8de]">Change my password</summary>
      <div className="space-y-1.5 border-t border-white/5 p-2">
        <input aria-label="Current password" type="password" placeholder="Current password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} className={field} />
        <input aria-label="New password" type="password" placeholder="New password" value={f.new} onChange={(e) => setF({ ...f, new: e.target.value })} className={field} />
        {err && <p role="alert" className="text-[12px] text-[#ffb4b4]">{err}</p>}
        <button disabled={!f.old || f.new.length < 8} onClick={async () => { setErr(""); try { await api("/api/auth/password", f); onDone("Password changed. Sign in again."); } catch (x) { setErr((x as Error).message); } }} className={quiet}>Change it</button>
      </div>
    </details>
  );
}

/** The person in the top bar, and the team behind it. */
export function TeamButton() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const user = me.user as Rec | null;
  const changed = () => window.dispatchEvent(new Event("account-changed"));
  return (
    <>
      <button onClick={() => setOpen(true)} title={user ? `${user.name}, ${user.role_name}` : "Team and accounts"} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 px-2 py-1.5 text-[11.5px] text-[#d3d8de] hover:bg-white/[.07]">
        <Icon name="person" className="h-3.5 w-3.5" /><span className="max-w-[90px] truncate max-[1500px]:hidden">{user ? user.name : "Team"}</span>
      </button>
      {open && (
        <div className="fixed inset-y-0 right-0 z-50 flex">
          <Side eyebrow="Team" title={user ? user.name : "Accounts"} onClose={() => setOpen(false)}>
            {user ? (
              <>
                <p className="flex items-center gap-2"><Pill tone="info">{user.role_name}</Pill><button onClick={async () => { await api("/api/auth/logout", {}); changed(); }} className={`${quiet} ml-auto`}>Sign out</button></p>
                <Password onDone={() => { void api("/api/auth/logout", {}).then(changed); }} />
                {user.role === "admin" && <People me={me} />}
              </>
            ) : <FirstAccount onDone={changed} />}
            <Matrix me={me} />
          </Side>
        </div>
      )}
    </>
  );
}
