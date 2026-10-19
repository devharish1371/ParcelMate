import { useEffect, useState, type FormEvent } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";
import Logo from "./Logo";
import InstallApp from "./InstallApp";
import Network from "./Network";
import Requests, { type ParcelRequest } from "./Requests";
import Going from "./Going";
import Support from "./Support";
import { apiFetch, apiJson, cloudMode } from "./api";
import { auth } from "./firebase";

type Wallet = { available: number; reserved: number; earned: number; spent: number };
type User = { id: string; email: string; studentId: string; name: string; wallet: Wallet };
type CreditEntry = { reason: string; availableDelta: number; reservedDelta: number; earnedDelta: number; spentDelta: number; createdAt: string };
type Tab = "home" | "requests" | "going" | "wallet" | "profile";
const isCollegeEmail = (value: string) => /^[^\s@]+@vitstudent\.ac\.in$/i.test(value);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  return apiJson<T>(path, options);
}

const navigation: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "requests", label: "Requests", icon: "▤" },
  { id: "going", label: "I'm Going", icon: "➜" },
  { id: "wallet", label: "Wallet", icon: "◫" },
  { id: "profile", label: "Profile", icon: "○" },
];

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = window.localStorage.getItem("parcelmate-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [networkOpen, setNetworkOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [homeRequests, setHomeRequests] = useState<ParcelRequest[]>([]);
  const [walletEntries, setWalletEntries] = useState<CreditEntry[]>([]);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");
  const [externalTesting, setExternalTesting] = useState(false);
  const [authPolicyReady, setAuthPolicyReady] = useState(!cloudMode);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("parcelmate-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!cloudMode) return;
    api<{ externalTesting: boolean }>("/api/access-policy")
      .then((policy) => setExternalTesting(policy.externalTesting))
      .catch(() => setExternalTesting(false))
      .finally(() => setAuthPolicyReady(true));
  }, []);

  function navigate(next: Tab) {
    setTab(next);
    setNetworkOpen(false);
    setSupportOpen(false);
  }

  async function refreshUser() {
    const result = await api<{ user: User }>("/api/me");
    setUser(result.user);
  }

  async function loadCloudProfile() {
    const response = await apiFetch("/api/me");
    if (response.status === 404) {
      setNeedsProfile(true);
      setVerificationPending(false);
      return;
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load your account.");
    setUser(body.user);
    setNeedsProfile(false);
    setVerificationPending(false);
  }

  useEffect(() => {
    if (!user || tab !== "home") return;
    api<{ requests: ParcelRequest[] }>("/api/requests")
      .then((result) => setHomeRequests(result.requests.filter((item) =>
        ["open", "accepted", "collected", "handed_over"].includes(item.status) &&
        (item.requesterId === user.id || item.helperId === user.id))))
      .catch(() => setHomeRequests([]));
  }, [user?.id, tab]);

  useEffect(() => {
    if (!user || tab !== "wallet") return;
    api<{ entries: CreditEntry[] }>("/api/wallet")
      .then((result) => setWalletEntries(result.entries))
      .catch(() => setWalletEntries([]));
  }, [user?.id, tab]);

  useEffect(() => {
    let active = true;
    if (cloudMode) {
      const unsubscribe = onAuthStateChanged(auth, async (current) => {
        if (!active) return;
        try {
          if (!current) {
            setUser(null);
            setNeedsProfile(false);
            setVerificationPending(false);
          } else {
            await reload(current);
            if (!active) return;
            if (!current.emailVerified) setVerificationPending(true);
            else {
              await current.getIdToken(true);
              await loadCloudProfile();
            }
          }
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : "Could not load your account.");
        } finally {
          if (active) setLoading(false);
        }
      });
      return () => { active = false; unsubscribe(); };
    }
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) {
      window.history.replaceState({}, "", "/");
      api<{ user: User }>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ token }),
      })
        .then((result) => { if (active) setUser(result.user); })
        .catch((cause) => { if (active) setError(cause.message); })
        .finally(() => { if (active) setLoading(false); });
    } else {
      api<{ user: User }>("/api/me")
        .then((result) => { if (active) setUser(result.user); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, []);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setDevelopmentUrl("");
    try {
      if (cloudMode) {
        const normalized = email.trim().toLowerCase();
        if (!isCollegeEmail(normalized) && !externalTesting) {
          throw new Error("Use your @vitstudent.ac.in email address.");
        }
        if (mode === "signup") {
          const account = await createUserWithEmailAndPassword(auth, normalized, password);
          await sendEmailVerification(account.user);
          setVerificationPending(true);
          setMessage("Check your college inbox and verify your email, then return here.");
        } else {
          const account = await signInWithEmailAndPassword(auth, normalized, password);
          await reload(account.user);
          if (account.user.emailVerified) {
            await account.user.getIdToken(true);
            await loadCloudProfile();
          }
          else {
            setVerificationPending(true);
            setMessage("Verify your college email before using ParcelMate.");
          }
        }
        return;
      }
      const result = await api<{
        message: string;
        developmentVerificationUrl?: string;
      }>("/api/auth/start", {
        method: "POST",
        body: JSON.stringify({ email, name, studentId }),
      });
      setMessage(result.message);
      setDevelopmentUrl(result.developmentVerificationUrl || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send a sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  async function completeProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>("/api/me", {
        method: "POST",
        body: JSON.stringify({ name, studentId }),
      });
      setUser(result.user);
      setNeedsProfile(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish your profile.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account", ...(externalTesting ? {} : { hd: "vitstudent.ac.in" }) });
      const { user: account } = await signInWithPopup(auth, provider);
      if (!account.email || (!isCollegeEmail(account.email) && !externalTesting)) {
        await firebaseSignOut(auth);
        throw new Error("Choose your @vitstudent.ac.in Google account.");
      }
      await account.getIdToken(true);
      await loadCloudProfile();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in with Google.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      if (cloudMode) await firebaseSignOut(auth);
      else await api("/api/auth/logout", { method: "POST" });
      setUser(null);
      setHomeRequests([]);
      setWalletEntries([]);
      setTab("home");
      setMessage("");
      setMode("login");
      setNeedsProfile(false);
      setVerificationPending(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }

  if (loading) {
    return <div className="app-shell"><div className="phone-frame loading"><Logo size={48} />Loading ParcelMate…</div></div>;
  }

  if (!user) {
    return (
      <div className="app-shell">
        <main className="phone-frame auth-screen">
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "light" ? "dark" : "light")} />
          <div className="brand-mark"><Logo size={68} /></div>
          <div className="auth-intro">
            <p className="eyebrow">STUDENT PARCEL NETWORK</p>
            <h1>ParcelMate</h1>
            <p>Ask trusted college friends to collect your parcel when you cannot make the trip.</p>
          </div>
          {cloudMode && verificationPending ? <section className="card auth-card form-stack">
            <h2>Verify your email</h2>
            <p className="muted">Check your inbox and Spam for a message from ParcelMate, then return here.</p>
            <button className="button primary" disabled={busy} onClick={() => {
              setBusy(true);
              setError("");
              void (async () => {
                const current = auth.currentUser;
                if (!current) throw new Error("Sign in again to continue.");
                await reload(current);
                if (!current.emailVerified) throw new Error("Your email is not verified yet.");
                await current.getIdToken(true);
                await loadCloudProfile();
              })().catch((cause) => setError(cause.message)).finally(() => setBusy(false));
            }}>{busy ? "Checking…" : "I've verified my email"}</button>
            <button className="button secondary" disabled={busy} onClick={() => {
              const current = auth.currentUser;
              if (current) void sendEmailVerification(current)
                .then(() => setMessage("A new verification email is on its way."))
                .catch((cause) => setError(cause.message));
            }}>Resend verification email</button>
            <button className="button secondary" disabled={busy || !authPolicyReady} onClick={() => void signInWithGoogle()}>{externalTesting ? "Continue with Google" : "Continue with VIT Google account"}</button>
            <button className="text-link" onClick={() => void signOut()}>Use another account</button>
            {error && <p className="feedback error" role="alert">{error}</p>}
            {message && <p className="feedback" role="status">{message}</p>}
          </section> : cloudMode && needsProfile ? <section className="card auth-card">
            <h2>Finish your student profile</h2>
            <p className="muted">Your email is verified. Add your name and {auth.currentUser?.email && !isCollegeEmail(auth.currentUser.email) ? "test ID" : "student ID"} to join ParcelMate.</p>
            <form onSubmit={completeProfile} className="form-stack">
              <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} autoComplete="name" /></label>
              <label>{auth.currentUser?.email && !isCollegeEmail(auth.currentUser.email) ? "Test ID" : "Student ID"}<input value={studentId} onChange={(event) => setStudentId(event.target.value)} required minLength={3} maxLength={32} autoCapitalize="characters" /></label>
              <button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create profile"}</button>
            </form>
            <button className="text-link" onClick={() => void signOut()}>Use another account</button>
            {error && <p className="feedback error" role="alert">{error}</p>}
          </section> : <section className="card auth-card">
            <div className="mode-switch" role="tablist" aria-label="Account action">
              <button type="button" className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button>
              <button type="button" className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
            </div>
            <h2>{mode === "signup" ? "Verify your student account" : "Welcome back"}</h2>
            <p className="muted">{cloudMode ? externalTesting ? "VIT students and invited testers can use Google or email and password." : "Sign in with your VIT Google account, or use your college email and a password." : "We send a one-time link to your college email."}</p>
            {cloudMode && <button className="button secondary" type="button" disabled={busy || !authPolicyReady} onClick={() => void signInWithGoogle()}>{externalTesting ? "Continue with Google" : "Continue with VIT Google account"}</button>}
            <form onSubmit={submitEmail} className="form-stack">
              {mode === "signup" && !cloudMode && (
                <>
                  <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" /></label>
                  <label>Student ID<input value={studentId} onChange={(event) => setStudentId(event.target.value)} required autoCapitalize="characters" /></label>
                </>
              )}
              <label>{externalTesting ? "Email" : "College email"}<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required placeholder={externalTesting ? "Your invited email" : "name@vitstudent.ac.in"} autoComplete="email" /></label>
              {cloudMode && <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>}
              <button className="button primary" type="submit" disabled={busy || !authPolicyReady}>{busy ? "Please wait…" : cloudMode ? mode === "signup" ? "Create account" : "Log in" : "Send verification link"}</button>
            </form>
            {error && <p className="feedback error" role="alert">{error}</p>}
            {message && <p className="feedback" role="status">{message}</p>}
            {developmentUrl && <a className="dev-link" href={developmentUrl}>Open local development link →</a>}
          </section>}
          <InstallApp />
          <p className="auth-footer">{externalTesting ? "Verified VIT students & invited testers" : "Only verified VIT students"} · 2 starting credits · No payments</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="phone-frame">
        <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "light" ? "dark" : "light")} />
        <main className="screen-content">
          {tab === "home" && (
            <>
              <header className="topbar"><BrandLabel /><h1>Hi, {user.name.split(" ")[0]}</h1><p>Good to have you here.</p></header>
              <section className="card balance-card"><div><p className="eyebrow">AVAILABLE CREDITS</p><strong>{user.wallet.available}</strong></div><button className="text-link" onClick={() => navigate("wallet")}>View wallet →</button></section>
              <button className="button primary" onClick={() => navigate("requests")}>Request Collection <span>→</span></button>
              <button className="button secondary" onClick={() => navigate("going")}>I'm Going to a Collection Point <span>→</span></button>
              <h2 className="section-title">Your parcel activity</h2>
              {homeRequests.length === 0 ? <section className="card empty-card"><div className="small-icon">□</div><strong>No active requests yet</strong><p>Your requests and helping tasks will appear here.</p></section> : <section className="card home-activity"><strong>{homeRequests.length} active {homeRequests.length === 1 ? "request" : "requests"}</strong><p>{homeRequests[0].parcelLabel} · {homeRequests[0].circleName}</p><button className="text-link" onClick={() => navigate("requests")}>View requests →</button></section>}
              <h2 className="section-title">Trusted friends</h2>
              <section className="card note-card"><strong>Friends & private circles</strong><p>Invite verified students, then group trusted friends for parcel requests.</p><button className="text-link" onClick={() => { setTab("profile"); setNetworkOpen(true); }}>Manage your network →</button></section>
            </>
          )}
          {tab === "requests" && <Requests userId={user.id} onChanged={refreshUser} onNetwork={() => { setTab("profile"); setNetworkOpen(true); }} />}
          {tab === "going" && <Going userId={user.id} onChanged={refreshUser} onNetwork={() => { setTab("profile"); setNetworkOpen(true); }} onRequestCreated={() => setTab("requests")} />}
          {tab === "wallet" && (
            <>
              <header className="topbar"><BrandLabel /><h1>Credit wallet</h1><p>Credits are for parcel favours, never money.</p></header>
              <section className="card balance-card"><div><p className="eyebrow">AVAILABLE</p><strong>{user.wallet.available}</strong></div></section>
              <div className="stats-grid">
                <section className="card"><span>Reserved</span><strong>{user.wallet.reserved}</strong></section>
                <section className="card"><span>Earned</span><strong>{user.wallet.earned}</strong></section>
                <section className="card"><span>Spent</span><strong>{user.wallet.spent}</strong></section>
              </div>
              <section className="card note-card"><strong>Welcome credits</strong><p>Your 2 starting credits were added once when you verified your email.</p></section>
              <h2 className="section-title">Credit activity</h2>
              {walletEntries.length === 0 ? <section className="card soft-empty"><strong>No activity yet</strong><p>Credit changes will appear here.</p></section> : walletEntries.map((entry, index) => <div className="card credit-entry" key={`${entry.createdAt}-${index}`}><div><strong>{creditReason(entry.reason)}</strong><span>{new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span></div><b>{creditChange(entry)}</b></div>)}
            </>
          )}
          {tab === "profile" && networkOpen && <Network userId={user.id} onBack={() => setNetworkOpen(false)} />}
          {tab === "profile" && supportOpen && <Support onBack={() => setSupportOpen(false)} />}
          {tab === "profile" && !networkOpen && !supportOpen && (
            <>
              <header className="topbar"><BrandLabel /><h1>Profile</h1><p>{isCollegeEmail(user.email) ? "Verified student account" : "Verified test account"}</p></header>
              <section className="card profile-card"><div className="avatar">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><strong>{user.name}</strong><p>{user.email}</p><span className="status-pill">{isCollegeEmail(user.email) ? "Verified student" : "Verified tester"}</span></div></section>
              <button className="card profile-link" onClick={() => setNetworkOpen(true)}><span><strong>Friends & circles</strong><small>Invitations and private groups</small></span><span aria-hidden="true">→</span></button>
              <button className="card profile-link" onClick={() => setSupportOpen(true)}><span><strong>Report an issue</strong><small>Technical support for app problems</small></span><span aria-hidden="true">→</span></button>
              <section className="card detail-card"><div><span>Student ID</span><strong>{user.studentId}</strong></div><div><span>College email</span><strong>{user.email}</strong></div></section>
              <section className="card theme-card"><span><strong>Appearance</strong><small>{theme === "light" ? "Light mode" : "Dark mode"}</small></span><button className="small-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Switch to dark" : "Switch to light"}</button></section>
              <InstallApp />
              <button className="button secondary" onClick={signOut}>Sign out</button>
              {error && <p className="feedback error" role="alert">{error}</p>}
            </>
          )}
        </main>
        <nav className="bottom-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={tab === item.id ? "page" : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
        </nav>
      </div>
    </div>
  );
}

function BrandLabel() {
  return <div className="brand-label"><Logo size={24} /><span>PARCELMATE</span></div>;
}

function creditReason(reason: string) {
  const labels: Record<string, string> = {
    welcome: "Starting credits",
    request_reserved: "Parcel request reserved",
    request_released: "Cancelled request released",
    request_spent: "Confirmed handover spent",
    help_earned: "Help earned",
  };
  return labels[reason] || "Credit update";
}

function creditChange(entry: CreditEntry) {
  if (entry.earnedDelta > 0) return `+${entry.earnedDelta} earned`;
  if (entry.spentDelta > 0) return `${entry.spentDelta} spent`;
  if (entry.reservedDelta > 0) return `${entry.reservedDelta} reserved`;
  return `${entry.availableDelta > 0 ? "+" : ""}${entry.availableDelta} available`;
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return <button className="theme-toggle" onClick={onToggle} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "☾" : "☼"}</button>;
}
