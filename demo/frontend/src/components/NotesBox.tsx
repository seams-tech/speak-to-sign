// The parts of a note that the timeline's cards share: which note a post shows, and the rating
// line under a note of this app.

import { type Note } from '../notes/types';
import { RATING_LABELS, useDemo } from '../demoContext';
import { VoiceSigned } from './bits';

/** The note that a post shows: the helpful note with the most helpful ratings. */
export function shownNote(notes: Note[]): Note | undefined {
  return notes
    .filter((note) => note.status === 'helpful')
    .sort((a, b) => b.helpful - a.helpful || a.id - b.id)[0];
}

/** Under a note of this app: its author's own line, or the visitor's rating and "Rate it". */
export function NoteRateLine({ note }: { note: Note }) {
  const { account } = useDemo();
  if (note.hidden) return null;
  return note.author === account ? <OwnNoteRow /> : <RateRow note={note} />;
}

function OwnNoteRow() {
  return <div className="note-foot muted">You wrote this note. Other accounts rate it.</div>;
}

function RateRow({ note }: { note: Note }) {
  const { account, myRatings, ratingTx, openRate } = useDemo();
  const rating = myRatings[note.id];
  if (account && rating) {
    return (
      <div className="note-foot note-rate">
        <div>
          <b>You rated this note</b>
          <div className="muted small">
            {RATING_LABELS[rating]} · <VoiceSigned account={account} hash={ratingTx[note.id]} />
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => openRate(note.id)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="note-foot note-rate">
      <span>Do you find this helpful?</span>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => openRate(note.id)}>
        Rate it
      </button>
    </div>
  );
}
