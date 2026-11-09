import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { HowItWorks, SetupPanel } from './components/SetupPanel';
import { PostDetail } from './components/PostDetail';
import { RateNoteModal } from './components/RateNoteModal';
import { Rail } from './components/Rail';
import { Timeline } from './components/Timeline';
import { WriteNoteModal } from './components/WriteNoteModal';
import { findPost, POSTS } from './data/posts';
import { DemoContext, type DemoState } from './demoContext';
import type { Note } from './notes/types';
import { useRoute } from './router';
import { createServices } from './services';
import type { Rating, SignerStatus } from './signer/notesSigner';

const POLL_MS = 1200;

export function App() {
  const services = useMemo(createServices, []);
  const route = useRoute();
  const wide = useMediaQuery('(min-width: 1080px)');

  const [status, setStatus] = useState<SignerStatus | null>(null);
  const [notesByPost, setNotesByPost] = useState<Record<number, Note[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myRatings, setMyRatings] = useState<Record<number, Rating>>({});
  const [noteTx, setNoteTx] = useState<Record<number, string>>({});
  const [ratingTxByKey, setRatingTxByKey] = useState<Record<string, string>>({});
  const [writeFor, setWriteFor] = useState<number | null>(null);
  const [rateFor, setRateFor] = useState<number | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const account = status?.signedIn ? status.accountId : undefined;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await services.signer.status());
    } catch {
      setStatus({ signedIn: false, voiceReady: false });
    }
  }, [services]);

  const loadPost = useCallback(
    async (postId: number) => {
      const notes = await services.store.getNotes(postId);
      setNotesByPost((current) => ({ ...current, [postId]: notes }));
      return notes;
    },
    [services],
  );

  const loadAll = useCallback(async () => {
    try {
      const entries = await Promise.all(POSTS.map(async (post) => [post.id, await services.store.getNotes(post.id)] as const));
      setNotesByPost(Object.fromEntries(entries));
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [services]);

  const reload = useCallback(() => {
    void refreshStatus();
    void loadAll();
  }, [refreshStatus, loadAll]);

  useEffect(() => {
    reload();
    const unsubscribe = services.mock?.subscribe(reload);
    const onFocus = () => void refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [services, reload, refreshStatus]);

  // The ratings of the signed-in account, from the contract view `get_rating`.
  useEffect(() => {
    if (!account) {
      setMyRatings({});
      return;
    }
    let cancelled = false;
    const notes = Object.values(notesByPost)
      .flat()
      .filter((note) => note.author !== account);
    Promise.all(notes.map(async (note) => [note.id, await services.store.getRating(note.id, account)] as const))
      .then((entries) => {
        if (cancelled) return;
        const ratings: Record<number, Rating> = {};
        for (const [noteId, rating] of entries) if (rating) ratings[noteId] = rating;
        setMyRatings(ratings);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account, notesByPost, services]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (text: string) => setToast({ id: Date.now(), text });

  // After `add_note`, read the post until the new note shows, and keep its transaction.
  const onNoteSent = async (postId: number, summary: string, hash: string) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const notes = await loadPost(postId);
        const mine = notes.find((note) => note.author === account && note.summary === summary);
        if (mine) {
          setNoteTx((current) => (current[mine.id] ? current : { ...current, [mine.id]: hash }));
          return;
        }
      } catch {
        // Try again below.
      }
      await sleep(POLL_MS);
    }
  };

  // After `rate_note`, read the post until the counts change.
  const onRatingSent = async (note: Note, rating: Rating, hash: string) => {
    if (account) {
      setMyRatings((current) => ({ ...current, [note.id]: rating }));
      setRatingTxByKey((current) => ({ ...current, [`${account}:${note.id}`]: hash }));
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const fresh = (await loadPost(note.post_id)).find((candidate) => candidate.id === note.id);
        if (fresh && (fresh.helpful !== note.helpful || fresh.somewhat_helpful !== note.somewhat_helpful || fresh.not_helpful !== note.not_helpful)) return;
      } catch {
        // Try again below.
      }
      await sleep(POLL_MS);
    }
  };

  const ratingTx = useMemo(() => {
    const result: Record<number, string> = {};
    if (!account) return result;
    for (const [key, hash] of Object.entries(ratingTxByKey)) {
      const [owner, noteId] = key.split(':');
      if (owner === account && noteId) result[Number(noteId)] = hash;
    }
    return result;
  }, [account, ratingTxByKey]);

  const state: DemoState = {
    services,
    status,
    account,
    notesByPost,
    loading,
    loadError,
    myRatings,
    noteTx,
    ratingTx,
    openWrite: setWriteFor,
    openRate: setRateFor,
    reload,
  };

  const writePost = writeFor === null ? undefined : findPost(writeFor);
  const rateNote = rateFor === null ? undefined : Object.values(notesByPost).flat().find((note) => note.id === rateFor);

  return (
    <DemoContext.Provider value={state}>
      <div className="layout">
        <Rail onHome={route.name === 'home'} />
        <main className="column">
          {!wide && <SetupPanel compact />}
          {route.name === 'home' ? <Timeline tab={route.tab} /> : <PostDetail postId={route.postId} />}
        </main>
        {wide && (
          <aside className="side">
            <SetupPanel compact={false} />
            <HowItWorks />
            <p className="side-foot muted">Demo for the NEAR Hackathon. The posts and accounts are fictional. NEAR testnet only.</p>
          </aside>
        )}
      </div>

      {writePost && (
        <WriteNoteModal
          key={writePost.id}
          post={writePost}
          onClose={() => setWriteFor(null)}
          onSent={(summary, hash) => void onNoteSent(writePost.id, summary, hash)}
          onDone={() => {
            setWriteFor(null);
            showToast('Your note was signed and submitted');
          }}
        />
      )}
      {rateNote && (
        <RateNoteModal
          key={rateNote.id}
          note={rateNote}
          onClose={() => setRateFor(null)}
          onSent={(rating, hash) => void onRatingSent(rateNote, rating, hash)}
          onDone={() => {
            setRateFor(null);
            showToast('Your rating was signed by voice');
          }}
        />
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        )}
      </div>
    </DemoContext.Provider>
  );
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
