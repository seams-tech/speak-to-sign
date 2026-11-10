import { useEffect, useRef } from 'react';
import { IconUsers } from '@tabler/icons-react';
import { MIN_RATINGS_FOR_STATUS, type Note } from '../notes/types';
import { RATING_LABELS, useDemo } from '../demoContext';
import { useMarketSource } from '../market/contractSource';
import { NoteMarketStrip } from '../market/NoteMarket';
import { marketContext } from '../market/noteContext';
import { Linkified, VoiceSigned } from './bits';

const ABOUT_URL = 'https://github.com/seams-tech/speak-to-sign';

/** The note that a post shows: the helpful note with the most helpful ratings. */
export function shownNote(notes: Note[]): Note | undefined {
  return notes
    .filter((note) => note.status === 'helpful')
    .sort((a, b) => b.helpful - a.helpful || a.id - b.id)[0];
}

/** Notes that need more ratings, which the account did not write. */
export function notesToRate(notes: Note[], account: string | undefined): Note[] {
  return notes.filter((note) => note.status === 'needs_more_ratings' && note.author !== account);
}

/** All notes on the post page: the shown note, the account's own notes and notes to rate. */
export function PostNotes({ notes }: { notes: Note[] }) {
  const { account } = useDemo();
  const shown = shownNote(notes);
  const mine = notes.filter((note) => note.author === account && note.id !== shown?.id);
  const toRate = notesToRate(notes, account);

  return (
    <>
      {shown && (
        <>
          <NoteCard note={shown} kind="shown" />
          <p className="notes-caption">
            Context is written by people who use this site, and appears when rated helpful by others.{' '}
            <a className="lk" href={ABOUT_URL} target="_blank" rel="noopener noreferrer">
              Find out more
            </a>
          </p>
        </>
      )}
      {mine.map((note) => (
        <NoteCard key={note.id} note={note} kind="mine" />
      ))}
      {toRate.map((note) => (
        <NoteCard key={note.id} note={note} kind="to_rate" />
      ))}
    </>
  );
}

/** The short form on the timeline: the shown note, and a line for notes that need ratings. */
export function TimelineNotes({ notes, showToRate }: { notes: Note[]; showToRate: boolean }) {
  const { account } = useDemo();
  const shown = shownNote(notes);
  const mine = notes.filter((note) => note.author === account && note.status === 'needs_more_ratings');
  const toRate = notesToRate(notes, account);

  return (
    <>
      {shown && <NoteCard note={shown} kind="shown" compact />}
      {showToRate && toRate.map((note) => <NoteCard key={note.id} note={note} kind="to_rate" />)}
      {!showToRate && (mine.length > 0 || toRate.length > 0) && (
        <div className="tl-pending">
          <IconUsers size={16} stroke={1.8} aria-hidden="true" />
          {mine.length > 0
            ? 'Your note needs more ratings'
            : `${toRate.length} proposed ${toRate.length === 1 ? 'note needs' : 'notes need'} your rating`}
        </div>
      )}
    </>
  );
}

type CardKind = 'shown' | 'mine' | 'to_rate';

function NoteCard({ note, kind, compact = false }: { note: Note; kind: CardKind; compact?: boolean }) {
  const { account, noteTx, freshNoteId, prepare } = useDemo();
  const marketSource = useMarketSource();
  // The note that the visitor just posted moves in with a short highlight, in view.
  const fresh = kind === 'mine' && note.id === freshNoteId;
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (fresh) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fresh]);
  const mineNotShown = kind === 'mine' && note.status === 'not_helpful';
  const title =
    kind === 'shown'
      ? 'Readers added context they thought people might want to know'
      : kind === 'to_rate'
        ? 'Help rate this proposed note'
        : note.status === 'helpful'
          ? 'Your note was rated helpful'
          : mineNotShown
            ? 'Your note is not shown'
            : 'Your note needs more ratings';

  return (
    <section
      ref={cardRef}
      className={`note-card ${fresh ? 'note-fresh' : ''}`}
      aria-label={title}
      onClick={compact ? undefined : (event) => event.stopPropagation()}
    >
      <header className="note-head">
        <IconUsers size={20} stroke={1.8} className={kind === 'shown' ? 'note-icon-shown' : 'note-icon'} aria-hidden="true" />
        <b>{title}</b>
      </header>
      <div className="note-body">
        {note.hidden ? <p className="muted">The moderators hid this note.</p> : <Linkified text={note.text} />}
      </div>
      {!compact && (
        <div className="note-meta">
          <VoiceSigned account={note.author} hash={noteTx[note.id]} extra={note.hidden ? undefined : <> · “{note.summary}”</>} />
        </div>
      )}
      {!compact && kind === 'mine' && (
        <div className="note-foot muted">
          {mineNotShown
            ? 'Raters marked it not helpful.'
            : note.status === 'helpful'
              ? `Helpful: ${note.helpful}. Somewhat: ${note.somewhat_helpful}. Not helpful: ${note.not_helpful}.`
              : `Helpful ratings: ${note.helpful} of ${MIN_RATINGS_FOR_STATUS} needed. Somewhat: ${note.somewhat_helpful}. Not helpful: ${note.not_helpful}.`}
        </div>
      )}
      {!compact && kind !== 'mine' && (note.author === account ? <OwnNoteRow /> : <RateRow note={note} />)}
      {!compact && <NoteMarketStrip noteId={note.id} source={marketSource} account={account} onSignIn={() => prepare({ funds: 'bet' }).then((ready) => ready.ok)} context={marketContext(note)} />}
    </section>
  );
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
