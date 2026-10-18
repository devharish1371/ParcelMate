import { useEffect, useState, type FormEvent } from "react";
import Logo from "./Logo";

export type ParcelRequest = {
  id: string;
  circleId: string;
  circleName: string;
  requesterId: string;
  requesterName: string;
  helperId: string | null;
  helperName: string | null;
  parcelLabel: string;
  collectionPoint: string;
  note: string;
  status: "open" | "accepted" | "collected" | "handed_over" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type Circle = { id: string; name: string; members: { id: string }[] };
type View = "mine" | "help" | "history";

async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result as T;
}

const active = new Set(["open", "accepted", "collected", "handed_over"]);
const labels: Record<ParcelRequest["status"], string> = {
  open: "Open for help",
  accepted: "Helper assigned",
  collected: "Collected",
  handed_over: "Handed over",
  completed: "Complete",
  cancelled: "Cancelled",
};

export default function Requests({ userId, onChanged, onNetwork }: {
  userId: string;
  onChanged: () => Promise<void>;
  onNetwork: () => void;
}) {
  const [requests, setRequests] = useState<ParcelRequest[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [view, setView] = useState<View>("mine");
  const [showForm, setShowForm] = useState(false);
  const [circleId, setCircleId] = useState("");
  const [parcelLabel, setParcelLabel] = useState("");
  const [collectionPoint, setCollectionPoint] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const [requestData, networkData] = await Promise.all([
      api<{ requests: ParcelRequest[] }>("/api/requests"),
      api<{ circles: Circle[] }>("/api/network"),
    ]);
    setRequests(requestData.requests);
    setCircles(networkData.circles);
    setCircleId((current) => current || networkData.circles[0]?.id || "");
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);

  async function perform(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await Promise.all([refresh(), onChanged()]);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(
      () => api("/api/requests", "POST", { circleId, parcelLabel, collectionPoint, note }),
      "Request shared with your circle. One credit is reserved until completion or cancellation.",
    ).then((ok) => {
      if (ok) {
        setParcelLabel("");
        setCollectionPoint("");
        setNote("");
        setShowForm(false);
        setView("mine");
      }
    });
  }

  const visible = requests.filter((request) => {
    if (view === "mine") return request.requesterId === userId && active.has(request.status);
    if (view === "help") {
      return request.requesterId !== userId &&
        (request.status === "open" || (request.helperId === userId && active.has(request.status)));
    }
    return !active.has(request.status) &&
      (request.requesterId === userId || request.helperId === userId);
  });

  const actions = (request: ParcelRequest): { key: string; label: string; primary?: boolean }[] => {
    if (request.requesterId === userId) {
      if (request.status === "handed_over") return [{ key: "confirm", label: "Confirm receipt", primary: true }];
      if (request.status === "open" || request.status === "accepted") return [{ key: "cancel", label: "Cancel request" }];
    } else if (request.status === "open") return [{ key: "accept", label: "I'll collect this", primary: true }];
    else if (request.helperId === userId && request.status === "accepted") return [{ key: "collect", label: "Mark collected", primary: true }];
    else if (request.helperId === userId && request.status === "collected") return [{ key: "handover", label: "Mark handed over", primary: true }];
    return [];
  };

  return <>
    <header className="topbar"><div className="brand-label"><Logo size={24} /><span>PARCELMATE</span></div><h1>Parcel requests</h1><p>Ask your circle for help, or collect for a friend.</p></header>
    <button className="button primary" onClick={() => setShowForm((current) => !current)} aria-expanded={showForm}>New request <span>{showForm ? "−" : "+"}</span></button>
    {showForm && (
      <section className="card request-form-card">
        <h2>Request collection</h2>
        {circles.length === 0 ? <><p className="muted">Create or join a private circle first.</p><button className="text-link" onClick={onNetwork}>Open friends & circles →</button></> : (
          <form className="form-stack" onSubmit={submit}>
            <label>Share with circle<select value={circleId} onChange={(event) => setCircleId(event.target.value)} required>{circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name} · {circle.members.length} members</option>)}</select></label>
            <label>Parcel label<input required minLength={2} maxLength={80} placeholder="e.g. Books from home" value={parcelLabel} onChange={(event) => setParcelLabel(event.target.value)} /></label>
            <label>Collection point<input required minLength={2} maxLength={80} placeholder="e.g. Main gate parcel desk" value={collectionPoint} onChange={(event) => setCollectionPoint(event.target.value)} /></label>
            <label>Note for your friend <span className="optional">optional</span><textarea maxLength={240} placeholder="Only details needed to coordinate collection" value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <p className="form-hint">Do not share courier OTPs. One available credit will be reserved.</p>
            <button className="button primary" type="submit" disabled={busy}>{busy ? "Sharing…" : "Share request"}</button>
          </form>
        )}
      </section>
    )}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback success" role="status">{notice}</p>}
    <div className="request-tabs" role="tablist" aria-label="Request view">
      {(["mine", "help", "history"] as const).map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item === "mine" ? "Mine" : item === "help" ? "Help friends" : "History"}</button>)}
    </div>
    {loading ? <p className="muted">Loading requests…</p> : visible.length === 0 ? (
      <section className="card empty-card request-empty"><div className="small-icon">□</div><strong>{view === "mine" ? "No active requests" : view === "help" ? "No one needs help yet" : "No request history"}</strong><p>{view === "mine" ? "Share a request with a private circle when you need a hand." : view === "help" ? "Open requests from your circles will appear here." : "Completed and cancelled requests appear here."}</p></section>
    ) : visible.map((request) => <article className="card request-card" key={request.id}>
      <div className="section-row"><span className="eyebrow">{request.circleName.toUpperCase()}</span><span className={`status-pill status-${request.status}`}>{labels[request.status]}</span></div>
      <h2>{request.parcelLabel}</h2>
      <p className="request-point">⌖ {request.collectionPoint}</p>
      {request.note && <p className="request-note">{request.note}</p>}
      <div className="request-meta"><span>{request.requesterId === userId ? "Requested by you" : `For ${request.requesterName}`}</span><span>{request.helperId ? `Helper: ${request.helperId === userId ? "you" : request.helperName}` : "No helper yet"}</span></div>
      <p className="request-date">{new Date(request.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
      {actions(request).length > 0 && <div className="request-actions">{actions(request).map((action) => <button key={action.key} className={`button compact ${action.primary ? "primary" : "secondary"}`} disabled={busy} onClick={() => void perform(() => api(`/api/requests/${request.id}/${action.key}`, "POST"), action.key === "confirm" ? "Receipt confirmed. Your helper earned one credit." : action.key === "cancel" ? "Request cancelled. Your reserved credit is available again." : "Request updated.")}>{action.label}</button>)}</div>}
      {request.status === "handed_over" && request.requesterId === userId && <p className="form-hint">Confirm only after the parcel is with you.</p>}
    </article>)}
  </>;
}
