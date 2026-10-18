import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "./api";

type Friend = { id: string; name: string; email: string };
type Invitation = {
  id: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  recipientId: string;
  recipientName: string;
};
type Circle = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  members: Friend[];
};
type NetworkData = { friends: Friend[]; invitations: Invitation[]; circles: Circle[] };

async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await apiFetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result as T;
}

export default function Network({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [data, setData] = useState<NetworkData | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [circleName, setCircleName] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    setData(await api<NetworkData>("/api/network"));
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause.message));
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

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(
      () => api("/api/network/invitations", "POST", { email: inviteEmail }),
      "Invitation sent. Your friend can accept it from their account.",
    ).then((ok) => { if (ok) setInviteEmail(""); });
  }

  function submitCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(
      () => api("/api/network/circles", "POST", { name: circleName }),
      "Private circle created.",
    ).then((ok) => { if (ok) setCircleName(""); });
  }

  return (
    <>
      <header className="topbar network-heading">
        <button className="back-button" onClick={onBack} aria-label="Back to profile">←</button>
        <div><p className="eyebrow">PRIVATE NETWORK</p><h1>Friends & circles</h1><p>Keep parcel requests among people you trust.</p></div>
      </header>
      {error && <p className="feedback error" role="alert">{error}</p>}
      {notice && <p className="feedback success" role="status">{notice}</p>}

      <section className="card network-card">
        <div className="section-row"><div><p className="eyebrow">01 / CONNECT</p><h2>Invite a friend</h2></div><span className="count-chip">Verified only</span></div>
        <p className="muted">Enter a registered VIT student email. They choose whether to accept.</p>
        <form className="inline-form" onSubmit={submitInvite}>
          <label className="sr-only" htmlFor="invite-email">Friend's college email</label>
          <input id="invite-email" type="email" required placeholder="friend@vitstudent.ac.in" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
          <button className="button primary compact" disabled={busy} type="submit">Invite</button>
        </form>
      </section>

      {data?.invitations.some((item) => item.recipientId === userId) && (
        <section className="network-section">
          <div className="section-row"><h2>Invitations for you</h2><span className="count-chip">Action needed</span></div>
          {data.invitations.filter((item) => item.recipientId === userId).map((item) => (
            <div className="card invitation-card" key={item.id}>
              <div className="person-row"><span className="avatar small">{initials(item.senderName)}</span><div><strong>{item.senderName}</strong><p>{item.senderEmail}</p></div></div>
              <div className="side-actions">
                <button className="button primary compact" disabled={busy} onClick={() => void perform(() => api(`/api/network/invitations/${item.id}/accept`, "POST"), "Friend added.")}>Accept</button>
                <button className="button secondary compact" disabled={busy} onClick={() => void perform(() => api(`/api/network/invitations/${item.id}/decline`, "POST"), "Invitation declined.")}>Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="network-section">
        <div className="section-row"><h2>Your friends</h2><span className="count-chip">{data?.friends.length ?? 0}</span></div>
        {!data ? <p className="muted">Loading friends…</p> : data.friends.length === 0 ? (
          <div className="card soft-empty"><strong>No friends yet</strong><p>Invite a verified student to start a trusted circle.</p></div>
        ) : data.friends.map((friend) => (
          <div className="card friend-card" key={friend.id}><span className="avatar small">{initials(friend.name)}</span><div><strong>{friend.name}</strong><p>{friend.email}</p></div><span className="status-pill">Friend</span></div>
        ))}
        {data?.invitations.some((item) => item.senderId === userId) && (
          <p className="pending-note">Pending: {data.invitations.filter((item) => item.senderId === userId).map((item) => item.recipientName).join(", ")}</p>
        )}
      </section>

      <section className="network-section">
        <div className="section-row"><div><p className="eyebrow">02 / ORGANISE</p><h2>Private circles</h2></div><span className="count-chip">{data?.circles.length ?? 0}</span></div>
        <form className="inline-form create-circle-form" onSubmit={submitCircle}>
          <label className="sr-only" htmlFor="circle-name">New circle name</label>
          <input id="circle-name" required minLength={2} maxLength={40} placeholder="e.g. Hostel Friends" value={circleName} onChange={(event) => setCircleName(event.target.value)} />
          <button className="button secondary compact" disabled={busy} type="submit">Create</button>
        </form>
        {!data ? <p className="muted">Loading circles…</p> : data.circles.length === 0 ? (
          <div className="card soft-empty"><strong>No circles yet</strong><p>Create one, then add friends who accepted your invitation.</p></div>
        ) : data.circles.map((circle) => {
          const owned = circle.ownerId === userId;
          const candidates = data.friends.filter((friend) => !circle.members.some((member) => member.id === friend.id));
          return (
            <div className="card circle-card" key={circle.id}>
              <div className="section-row"><div><p className="eyebrow">{owned ? "YOUR PRIVATE CIRCLE" : `${circle.ownerName.toUpperCase()}'S CIRCLE`}</p><h3>{circle.name}</h3></div><span className="count-chip">{circle.members.length} members</span></div>
              <div className="member-list">{circle.members.map((member) => (
                <div className="member-row" key={member.id}><span className="avatar tiny">{initials(member.name)}</span><span>{member.id === userId ? "You" : member.name}</span>{owned && member.id !== userId && <button className="remove-button" disabled={busy} onClick={() => void perform(() => api(`/api/network/circles/${circle.id}/members/${member.id}`, "DELETE"), "Member removed.")} aria-label={`Remove ${member.name} from ${circle.name}`}>Remove</button>}</div>
              ))}</div>
              {owned && candidates.length > 0 && (
                <div className="add-member">
                  <label className="sr-only" htmlFor={`friend-${circle.id}`}>Friend to add to {circle.name}</label>
                  <select id={`friend-${circle.id}`} value={selectedFriends[circle.id] || ""} onChange={(event) => setSelectedFriends((current) => ({ ...current, [circle.id]: event.target.value }))}>
                    <option value="">Choose a friend</option>
                    {candidates.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
                  </select>
                  <button className="button secondary compact" disabled={busy || !selectedFriends[circle.id]} onClick={() => void perform(() => api(`/api/network/circles/${circle.id}/members`, "POST", { friendId: selectedFriends[circle.id] }), "Friend added to circle.").then((ok) => { if (ok) setSelectedFriends((current) => ({ ...current, [circle.id]: "" })); })}>Add</button>
                </div>
              )}
            </div>
          );
        })}
      </section>
      <p className="privacy-footnote">Only circle members will see requests shared with that circle.</p>
    </>
  );
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
