'use client';
import { useCallback, useEffect, useState } from 'react';
import { allSessions, deleteSession, getDevice, syncAll, type StoredSession } from '@/lib/client/local';

export function History({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const [list, setList] = useState<StoredSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = useCallback(async () => setList(await allSessions()), []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function sync() {
    setBusy(true); setNote(null);
    if (!getDevice()) setNote('This phone is not enrolled, so there is nowhere to upload to.');
    else { const r = await syncAll(); setNote(r.revoked ? 'This phone was removed from the study.' : r.sent ? `${r.sent} uploaded.` : r.pending ? 'Nothing uploaded. Check the connection and try again.' : 'Everything is uploaded.'); }
    await refresh(); setBusy(false);
  }
  async function clearUploaded() {
    for (const s of list ?? []) if (s.state === 'uploaded') await deleteSession(s.id);
    await refresh();
  }
  const uploaded = (list ?? []).filter((s) => s.state === 'uploaded').length;

  return (
    <main className="wrap">
      <div className="topbar"><button className="back" onClick={onBack}>← Back</button></div>
      <h1>Sessions on this phone</h1>
      <div className="btn-row"><button className="btn" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Upload now'}</button>{uploaded > 0 && <button className="btn" onClick={clearUploaded}>Remove {uploaded} uploaded from this phone</button>}</div>
      {note && <p className="notice" role="status">{note}</p>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">No sessions yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Participant</th><th className="r">#</th><th>Date</th><th>Mode</th><th>Status</th><th /></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id}>
                <td>{s.record.participantId}</td><td className="r">{s.record.sessionNo}</td><td>{new Date(s.record.startedAt).toLocaleDateString()}</td><td>{s.record.mode}</td>
                <td><span className={'chip ' + (s.state === 'uploaded' ? 'ok' : s.state === 'rejected' ? 'bad' : 'warn')}>{s.state === 'uploaded' ? 'Uploaded' : s.state === 'rejected' ? 'Rejected' : 'Waiting'}</span></td>
                <td><button className="back" onClick={() => onOpen(s.id)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
