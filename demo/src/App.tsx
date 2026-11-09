import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PostDetail } from './components/PostDetail';
import { RateNoteModal } from './components/RateNoteModal';
import { BottomBar, Rail } from './components/Rail';
import { HowItWorks, SetupPanel } from './components/SetupPanel';
import { NotesActivity, SideSearch, StickySide } from './components/SideColumn';
import { SignInModal } from './components/SignInModal';
import { Timeline } from './components/Timeline';
import { WriteNoteModal } from './components/WriteNoteModal';
import { config } from './config';
import { findPost, POSTS } from './data/posts';
import { DemoContext, type DemoState } from './demoContext';
import { RpcNotesStore } from './notes/rpcStore';
import type { Note } from './notes/types';
import { useRoute } from './router';
import type { NotesSigner, Rating, SignerSetup, SignerStatus } from './signer/notesSigner';

const POLL_MS = 1500;

export function App({ signer, walletConfigured }: { signer: NotesSigner & SignerSetup; walletConfigured: boolean }) {
  const store = useMemo(() => new RpcNotesStore(config.rpcUrl, config.contract), []);
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
  const [signingIn, setSigningIn] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const account = status?.signedIn ? status.accountId : undefined;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await signer.status());
    } catch {
      setStatus({ signedIn: false, voiceReady: false });
    }
  }, [signer]);

  const loadPost = useCallback(
    async (postId: number) => {
      const notes = await store.getNotes(postId);
      setNotesByPost((current) => ({ ...current, [postId]: notes }));
      return notes;
    },
    [store],
  );

  const loadAll = useCallback(async () => {
    try {
      const entries = await Promise.all(POSTS.map(async (post) => [post.id, await store.getNotes(post.id)] as const));
      setNotesByPost(Object.fromEntries(entries));
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [store]);

  const reload = useCallback(() => {
    void refreshStatus();
    void loadAll();
  }, [refreshStatus, loadAll]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    void loadAll();
    const onFocus = () => void refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAll, refreshStatus]);

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
    Promise.all(notes.map(async (note) => [note.id, await store.getRating(note.id, account)] as const))
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
  }, [account, notesByPost, store]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (text: string) => setToast({ id: Date.now(), text });

  // After `add_note`, read the post until the new note shows, and keep its transaction.
  const onNoteSent = async (postId: number, summary: string, hash: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
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
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const fresh = (await loadPost(note.post_id)).find((candidate) => candidate.id === note.id);
        if (
          fresh &&
          (fresh.helpful !== note.helpful || fresh.somewhat_helpful !== note.somewhat_helpful || fresh.not_helpful !== note.not_helpful)
        ) {
          return;
        }
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
      const separator = key.lastIndexOf(':');
      if (key.slice(0, separator) === account) result[Number(key.slice(separator + 1))] = hash;
    }
    return result;
  }, [account, ratingTxByKey]);

  const state: DemoState = {
    signer,
    walletConfigured,
    store,
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
    openSignIn: () =>
      walletConfigured ? setSigningIn(true) : showToast('This build has no Seams publishable key, so it cannot sign in'),
    reload,
  };

  const writePost = writeFor === null ? undefined : findPost(writeFor);
  const rateNote = rateFor === null ? undefined : Object.values(notesByPost).flat().find((note) => note.id === rateFor);

  return (
    <DemoContext.Provider value={state}>
      <div className="layout">
        <Rail route={route} />
        <main className="column">
          {!wide && <SetupPanel compact />}
          {route.name === 'home' ? <Timeline tab={route.tab} /> : <PostDetail postId={route.postId} />}
        </main>
        {wide && (
          <StickySide>
            <SideSearch />
            <SetupPanel compact={false} />
            <NotesActivity />
            <HowItWorks />
            <p className="side-foot muted">
              Also on this site:{' '}
              <a className="lk" href={config.payPath}>
                Speak to pay
              </a>
              , a NEAR payment by voice. Demo for the NEAR Hackathon. The posts are fictional. NEAR testnet only.
            </p>
          </StickySide>
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
      {signingIn && walletConfigured && (
        <SignInModal
          onClose={() => setSigningIn(false)}
          onSignedIn={() => {
            setSigningIn(false);
            reload();
            showToast('You are signed in to Seams Wallet');
          }}
        />
      )}
      <BottomBar route={route} />
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
