'use client';
import { useState } from 'react';
import type { StoredSession } from '@/lib/client/local';
import core from '@/lib/core';

const TAGS = core.ADVERSE_TAGS as { key: 'shoulder_pain' | 'elbow_pain' | 'fatigue' | 'dizziness' | 'other'; label: string }[];

const QS: [string, string][] = [
  ['Q1', 'Did you enjoy your experience with the system?'],
  ['Q2', 'Were you successful using the system?'],
  ['Q3', 'Were you able to control the system?'],
  ['Q4', 'Is the information provided by the system clear?'],
  ['Q5', 'Did you feel comfortable during your experience with the system?'],
  ['Q6', 'Do you think that this system will be helpful for your rehabilitation?'],
  ['Q7', 'Do you think this system can be used for home-based rehabilitation?']
];

export function Questions({ stored, onSave }: { stored: StoredSession; onSave: (s: StoredSession) => void }) {
  const [a, setA] = useState<Record<string, number>>({});
  const [neg, setNeg] = useState(''); const [sug, setSug] = useState('');
  const [adverse, setAdverse] = useState(''); const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function save(skip: boolean) {
    setBusy(true);
    const answered = Object.keys(a).length > 0 || neg.trim() || sug.trim();
    const questionnaire = !skip && answered ? { ...a, ...(neg.trim() ? { negative: neg.trim().slice(0, 1000) } : {}), ...(sug.trim() ? { suggestions: sug.trim().slice(0, 1000) } : {}) } : null;
    onSave({ ...stored, record: { ...stored.record, questionnaire, adverseTags: tags as typeof TAGS[number]['key'][], adverse: adverse.trim().slice(0, 1000), notes: notes.trim().slice(0, 2000) } });
  }

  return (
    <main className="wrap">
      <div className="topbar"><h1 style={{ fontSize: 30 }}>A few questions</h1></div>
      <p className="muted">For the participant. 1 means strongly disagree, 5 means strongly agree. You can skip this.</p>

      <div className="panel">
        {QS.map(([k, text]) => (
          <fieldset key={k} className="likert" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="q" style={{ padding: 0, marginBottom: 6 }}>{text}</legend>
            <div className="scale">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} style={{ display: 'contents' }}>
                  <input type="radio" name={k} id={`${k}-${n}`} checked={a[k] === n} onChange={() => setA({ ...a, [k]: n })} />
                  <label htmlFor={`${k}-${n}`} aria-label={`${n} of 5`}>{n}</label>
                </span>
              ))}
            </div>
            <div className="scale-ends"><span>Strongly disagree</span><span>Strongly agree</span></div>
          </fieldset>
        ))}
        <div className="field"><label htmlFor="neg">Did you feel any negative symptoms during or after the games? (dizziness, pain, tiredness…)</label><textarea id="neg" className="input" value={neg} onChange={(e) => setNeg(e.target.value)} maxLength={1000} /></div>
        <div className="field"><label htmlFor="sug">What would make the system better?</label><textarea id="sug" className="input" value={sug} onChange={(e) => setSug(e.target.value)} maxLength={1000} /></div>
      </div>

      <div className="panel soft">
        <h3>Therapist notes</h3>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, padding: 0, marginBottom: 6 }}>Did anything happen during the session?</legend>
          <div className="tagpick">
            {TAGS.map((t) => (
              <label key={t.key} className="check"><input type="checkbox" checked={tags.includes(t.key)} onChange={(e) => setTags(e.target.checked ? [...tags, t.key] : tags.filter((x) => x !== t.key))} /><span>{t.label}</span></label>
            ))}
          </div>
          <span className="hint">Leave all unticked if nothing happened.</span>
        </fieldset>
        <div className="field"><label htmlFor="adv">Adverse events, in words</label><textarea id="adv" className="input" value={adverse} onChange={(e) => setAdverse(e.target.value)} maxLength={1000} placeholder="Leave empty if none" /><span className="hint">Do not enter names or contact details.</span></div>
        <div className="field"><label htmlFor="nts">Session notes</label><textarea id="nts" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
      </div>

      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={() => save(false)}>Save session</button>
        <button className="btn" disabled={busy} onClick={() => save(true)}>Skip questions</button>
      </div>
    </main>
  );
}
