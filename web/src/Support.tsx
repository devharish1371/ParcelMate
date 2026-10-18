import { useEffect, useState, type FormEvent } from "react";

type Ticket = {
  id: string;
  category: "sign_in" | "notifications" | "display" | "other";
  description: string;
  status: "received" | "in_review" | "resolved";
  createdAt: string;
};

const categoryLabels: Record<Ticket["category"], string> = {
  sign_in: "Sign-in",
  notifications: "Notifications",
  display: "Display or theme",
  other: "Other technical issue",
};

export default function Support({ onBack }: { onBack: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [category, setCategory] = useState<Ticket["category"]>("display");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const response = await fetch("/api/support", { credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load reports.");
    setTickets(body.tickets);
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not submit report.");
      await refresh();
      setDescription("");
      setNotice("Technical report received.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit report.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <header className="topbar network-heading"><button className="back-button" onClick={onBack} aria-label="Back to profile">←</button><div><p className="eyebrow">TECHNICAL SUPPORT</p><h1>Report an issue</h1><p>Tell us about a problem with the app.</p></div></header>
    <section className="card support-scope"><strong>App problems only</strong><p>This form records sign-in, notification, or display issues. It does not update parcel requests or credits.</p></section>
    <form className="card form-stack support-form" onSubmit={submit}>
      <label>Issue type<select value={category} onChange={(event) => setCategory(event.target.value as Ticket["category"])}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>What happened?<textarea required minLength={20} maxLength={1000} placeholder="Describe the app problem and what you were trying to do" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <p className="form-hint">Please do not include passwords, courier OTPs, or private parcel details.</p>
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
    </form>
    {error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback success" role="status">{notice}</p>}
    <h2 className="section-title">Your reports</h2>
    {loading ? <p className="muted">Loading reports…</p> : tickets.length === 0 ? <section className="card soft-empty"><strong>No reports yet</strong><p>Reports you send will appear here.</p></section> : tickets.map((ticket) => <article className="card ticket-card" key={ticket.id}><div className="section-row"><strong>{categoryLabels[ticket.category]}</strong><span className="status-pill">{ticket.status.replace("_", " ")}</span></div><p>{ticket.description}</p><small>{new Date(ticket.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</small></article>)}
  </>;
}
