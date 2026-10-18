import { useEffect, useState, type FormEvent } from "react";
import Logo from "./Logo";

type Trip = {
  id: string;
  circleId: string;
  circleName: string;
  ownerId: string;
  ownerName: string;
  collectionPoint: string;
  note: string;
  scheduledAt: string;
  status: "open" | "closed";
  available: boolean;
  requestCount: number;
};
type Circle = { id: string; name: string; members: { id: string }[] };

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

function localInputTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function Going({ userId, onNetwork, onRequestCreated, onChanged }: {
  userId: string;
  onNetwork: () => void;
  onRequestCreated: () => void;
  onChanged: () => Promise<void>;
}) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [circleId, setCircleId] = useState("");
  const [collectionPoint, setCollectionPoint] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState(() => localInputTime(new Date(Date.now() + 60 * 60 * 1000)));
  const [note, setNote] = useState("");
  const [askingTrip, setAskingTrip] = useState<string | null>(null);
  const [parcelLabel, setParcelLabel] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    const [tripData, networkData] = await Promise.all([
      api<{ trips: Trip[] }>("/api/trips"),
      api<{ circles: Circle[] }>("/api/network"),
    ]);
    setTrips(tripData.trips);
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
      await refresh();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function postTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(() => api("/api/trips", "POST", {
      circleId,
      collectionPoint,
      scheduledAt: new Date(scheduledLocal).toISOString(),
      note,
    }), "Trip shared with your circle.").then((ok) => {
      if (ok) {
        setShowForm(false);
        setCollectionPoint("");
        setNote("");
      }
    });
  }

  function requestPickup(event: FormEvent<HTMLFormElement>, tripId: string) {
    event.preventDefault();
    void perform(() => api("/api/requests", "POST", {
      tripId, parcelLabel, note: requestNote,
    }), "Pickup requested. One credit is reserved; the trip maker is assigned to help.")
      .then(async (ok) => {
        if (ok) {
          await onChanged();
          setAskingTrip(null);
          setParcelLabel("");
          setRequestNote("");
          onRequestCreated();
        }
      });
  }

  const available = trips.filter((trip) => trip.available)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const past = trips.filter((trip) => !trip.available);

  return <>
    <header className="topbar"><div className="brand-label"><Logo size={24} /><span>PARCELMATE</span></div><h1>I'm Going</h1><p>Going to a collection point? Let your circle know.</p></header>
    <button className="button primary" onClick={() => setShowForm((current) => !current)} aria-expanded={showForm}>Post a trip <span>{showForm ? "−" : "+"}</span></button>
    {showForm && <section className="card request-form-card">
      <h2>Tell your circle</h2>
      {circles.length === 0 ? <><p className="muted">Create or join a private circle first.</p><button className="text-link" onClick={onNetwork}>Open friends & circles →</button></> : <form className="form-stack" onSubmit={postTrip}>
        <label>Share with circle<select value={circleId} onChange={(event) => setCircleId(event.target.value)} required>{circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name} · {circle.members.length} members</option>)}</select></label>
        <label>Collection point<input required minLength={2} maxLength={80} placeholder="e.g. Main gate parcel desk" value={collectionPoint} onChange={(event) => setCollectionPoint(event.target.value)} /></label>
        <label>When<input required type="datetime-local" min={localInputTime(new Date())} max={localInputTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))} value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} /></label>
        <label>Note <span className="optional">optional</span><textarea maxLength={240} placeholder="Anything friends should know" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <p className="form-hint">Requests made from this trip are assigned to you. You earn a credit only after the requester confirms handover.</p>
        <button className="button primary" type="submit" disabled={busy}>{busy ? "Posting…" : "Share trip"}</button>
      </form>}
    </section>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback success" role="status">{notice}</p>}
    <div className="section-row trip-section-title"><h2>Trips in your circles</h2><span className="count-chip">{available.length}</span></div>
    {loading ? <p className="muted">Loading trips…</p> : available.length === 0 ? <section className="card empty-card"><div className="small-icon">➜</div><strong>No upcoming trips</strong><p>When someone posts a collection point visit, it will appear here.</p></section> : available.map((trip) => <article className="card trip-card" key={trip.id}>
      <div className="section-row"><span className="eyebrow">{trip.circleName.toUpperCase()}</span><span className="status-pill">Open</span></div>
      <h3>{trip.collectionPoint}</h3>
      <p className="trip-time">{new Date(trip.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
      <p className="trip-owner">{trip.ownerId === userId ? "Your trip" : `${trip.ownerName} is going`} · {trip.requestCount} {trip.requestCount === 1 ? "pickup" : "pickups"}</p>
      {trip.note && <p className="request-note">{trip.note}</p>}
      {trip.ownerId === userId ? <button className="button secondary compact" disabled={busy} onClick={() => void perform(() => api(`/api/trips/${trip.id}/close`, "POST"), "Trip closed.")}>Close trip</button> : <>
        <button className="button secondary compact" onClick={() => { setAskingTrip(askingTrip === trip.id ? null : trip.id); setError(""); }} aria-expanded={askingTrip === trip.id}>Ask for pickup</button>
        {askingTrip === trip.id && <form className="form-stack trip-request-form" onSubmit={(event) => requestPickup(event, trip.id)}>
          <label>Parcel label<input required minLength={2} maxLength={80} placeholder="e.g. Books from home" value={parcelLabel} onChange={(event) => setParcelLabel(event.target.value)} /></label>
          <label>Note <span className="optional">optional</span><textarea maxLength={240} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Details needed for this pickup" /></label>
          <p className="form-hint">One credit is reserved. {trip.ownerName} is assigned to collect it.</p>
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Requesting…" : "Request pickup"}</button>
        </form>}
      </>}
    </article>)}
    {past.length > 0 && <><h2 className="section-title">Past trips</h2>{past.slice(0, 5).map((trip) => <div className="card trip-past" key={trip.id}><strong>{trip.collectionPoint}</strong><span>{trip.circleName} · {new Date(trip.scheduledAt).toLocaleDateString()} · {trip.status === "closed" ? "Closed" : "Expired"}</span></div>)}</>}
  </>;
}
