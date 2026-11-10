import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PostDetail } from './components/PostDetail';
import { RateNoteModal } from './components/RateNoteModal';
import { BottomBar, Rail } from './components/Rail';
import { SetupPanel, WalletWait } from './components/SetupPanel';
import { SignInModal } from './components/SignInModal';
import { WriteNoteModal } from './components/WriteNoteModal';
import { config } from './config';
import { findPost, POSTS, registerPosts, type Post } from './data/posts';
import { DemoContext, type DemoState, type PrepareNeeds, type Prepared, type PrepareStep } from './demoContext';
import { covers, ensureFunds, fundsProblem, peekFunds, readFunds } from './faucet/funds';
import { RpcNotesStore } from './notes/rpcStore';
import type { Note } from './notes/types';
import { routeKey, START_POST_ID, useRoute } from './router';
import { Timeline } from './x/Timeline';
import { loadXPosts } from './x/xPosts';
import type { NotesSigner, Rating, SignerSetup, SignerStatus } from './signer/notesSigner';
import { SETUP_CHANGED, setUpVoice, voiceIsSetUp, type VoicePhase } from './signer/voiceSetup';

const POLL_MS = 1500;
/** After the Wallet says "signed in", the page waits this long for the account to show. */
const SIGN_IN_SETTLE_MS = 10_000;
/** How long a new note keeps its highlight. */
const FRESH_NOTE_MS = 6000;

export function App({ signer, walletConfigured }: { signer: NotesSigner & SignerSetup; walletConfigured: boolean }) {
  const store = useMemo(() => new RpcNotesStore(config.rpcUrl, config.contract), []);
  const route = useRoute();
  // The app fills a window on the Speak-to-Sign page. It has two columns, the navigation and
  // the posts, with the Wallet steps at the top of the posts. A new page scrolls the app.
  const rootRef = useRef<HTMLDivElement>(null);
  const page = routeKey(route);
  useLayoutEffect(() => {
    rootRef.current?.scrollTo(0, 0);
  }, [page]);

  const [status, setStatus] = useState<SignerStatus | null>(null);
  const [notesByPost, setNotesByPost] = useState<Record<number, Note[]>>({});
  const [xPosts, setXPosts] = useState<Post[]>([]);
  const [xPostsState, setXPostsState] = useState<DemoState['xPostsState']>('loading');
  // The newest list, for `loadAll`: it also runs from `reload`, long after the posts arrived.
  const xPostsRef = useRef<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myRatings, setMyRatings] = useState<Record<number, Rating>>({});
  const [noteTx, setNoteTx] = useState<Record<number, string>>({});
  const [ratingTxByKey, setRatingTxByKey] = useState<Record<string, string>>({});
  const [writeFor, setWriteFor] = useState<number | null>(null);
  const [rateFor, setRateFor] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [preparing, setPreparing] = useState<PrepareStep | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase | null>(null);
  const [freshNoteId, setFreshNoteId] = useState<number | null>(null);

  const account = status?.signedIn ? status.accountId : undefined;

  // The newest values, for the steps of `prepare`: they run across a sign-in, which gives the
  // app a new signer and a new account.
  const signerRef = useRef(signer);
  const accountRef = useRef(account);
  const statusRef = useRef(status);
  useLayoutEffect(() => {
    signerRef.current = signer;
    accountRef.current = account;
    statusRef.current = status;
  });

  // Dialogs that show the sign-in as their own step. With none open, the sign-in is a dialog.
  const [signInHosts, setSignInHosts] = useState(0);
  const signingInRef = useRef(signingIn);
  useLayoutEffect(() => {
    signingInRef.current = signingIn;
  });

  // Callers of `openSignIn` that wait for the sign-in to end.
  const signInWaiters = useRef<((account: string | null) => void)[]>([]);
  const settleSignIn = useCallback((value: string | null) => {
    const waiters = signInWaiters.current;
    signInWaiters.current = [];
    for (const resolve of waiters) resolve(value);
  }, []);
  useEffect(() => {
    if (account) settleSignIn(account);
  }, [account, settleSignIn]);

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
      const posts = [...POSTS, ...xPostsRef.current];
      const entries = await Promise.all(posts.map(async (post) => [post.id, await store.getNotes(post.id)] as const));
      setNotesByPost((current) => ({ ...current, ...Object.fromEntries(entries) }));
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

  // The posts from X. They are registered before the first render that shows them, and their
  // notes load with the notes of the demo post.
  useEffect(() => {
    let cancelled = false;
    void loadXPosts().then((posts) => {
      if (cancelled) return;
      if (!posts) {
        setXPostsState('error');
        return;
      }
      registerPosts(posts);
      xPostsRef.current = posts;
      setXPosts(posts);
      setXPostsState('ready');
      void loadAll();
    });
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  useEffect(() => {
    void loadAll();
    const onFocus = () => {
      void refreshStatus();
      if (accountRef.current) void readFunds(accountRef.current);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(SETUP_CHANGED, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SETUP_CHANGED, onFocus);
    };
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

  useEffect(() => {
    if (freshNoteId === null) return;
    const timer = window.setTimeout(() => setFreshNoteId(null), FRESH_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [freshNoteId]);

  const endSignIn = useCallback(
    (signedIn: boolean) => {
      setSigningIn(false);
      if (!signedIn) {
        settleSignIn(null);
        return;
      }
      reload();
      setToast({ id: Date.now(), text: 'You are signed in to Seams Wallet' });
      // The account shows when the app has the new signer; the effect on `account` answers the
      // waiters. If it does not show, they stop waiting.
      window.setTimeout(() => settleSignIn(accountRef.current ?? null), SIGN_IN_SETTLE_MS);
    },
    [reload, settleSignIn],
  );

  // Stable, so a host dialog registers once: a sign-in gives the app a new signer, and with it
  // a new `endSignIn`, while the host is still open.
  const endSignInRef = useRef(endSignIn);
  useLayoutEffect(() => {
    endSignInRef.current = endSignIn;
  });
  const hostSignIn = useCallback(() => {
    setSignInHosts((count) => count + 1);
    return () => {
      setSignInHosts((count) => count - 1);
      // The dialog closed during its sign-in step: the sign-in ends with it.
      if (signingInRef.current) endSignInRef.current(false);
    };
  }, []);

  const openSignIn = useCallback((): Promise<string | null> => {
    if (!walletConfigured) {
      setToast({ id: Date.now(), text: 'This build has no Seams publishable key, so it cannot sign in' });
      return Promise.resolve(null);
    }
    if (accountRef.current) return Promise.resolve(accountRef.current);
    setSigningIn(true);
    return new Promise((resolve) => signInWaiters.current.push(resolve));
  }, [walletConfigured]);

  const prepare = useCallback(
    async (needs: PrepareNeeds, onStep?: (step: PrepareStep) => void): Promise<Prepared> => {
      const step = (next: PrepareStep) => {
        setPreparing(next);
        onStep?.(next);
      };
      try {
        let who = accountRef.current;
        if (!who) {
          step('signin');
          const signedIn = await openSignIn();
          if (!signedIn) return { ok: false };
          who = signedIn;
        }
        // Funds as last read are enough: no faucet, no wait. Otherwise the faucet runs while
        // the visitor sets up the voice.
        const need = needs.funds;
        const funded = need && !covers(peekFunds(who).balance, need) ? ensureFunds(who, need) : null;
        if (needs.voice && !voiceIsSetUp(statusRef.current, who)) {
          step('voice');
          const outcome = await setUpVoice(signerRef.current, who, setVoicePhase);
          setVoicePhase(null);
          if (outcome.kind !== 'done') {
            return { ok: false, step: 'voice', reason: outcome.kind === 'cancelled' ? undefined : outcome.message };
          }
        }
        if (need && funded) {
          step('funds');
          if (!(await funded)) return { ok: false, step: 'funds', reason: fundsProblem(who, need) };
        }
        return { ok: true, account: who, signer: signerRef.current };
      } finally {
        setVoicePhase(null);
        setPreparing(null);
      }
    },
    [openSignIn],
  );

  // After `add_note`, read the post until the new note shows, and keep its transaction.
  const onNoteSent = async (postId: number, summary: string, hash: string) => {
    if (accountRef.current) void readFunds(accountRef.current);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const notes = await loadPost(postId);
        const mine = notes.find((note) => note.author === accountRef.current && note.summary === summary);
        if (mine) {
          setNoteTx((current) => (current[mine.id] ? current : { ...current, [mine.id]: hash }));
          setFreshNoteId(mine.id);
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
    const rater = accountRef.current;
    if (rater) {
      void readFunds(rater);
      setMyRatings((current) => ({ ...current, [note.id]: rating }));
      setRatingTxByKey((current) => ({ ...current, [`${rater}:${note.id}`]: hash }));
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
    xPosts,
    xPostsState,
    loading,
    loadError,
    myRatings,
    noteTx,
    ratingTx,
    freshNoteId,
    preparing,
    openWrite: setWriteFor,
    openRate: setRateFor,
    openSignIn,
    signingIn,
    hostSignIn,
    endSignIn,
    prepare,
    reload,
  };

  const writePost = writeFor === null ? undefined : findPost(writeFor);
  const rateNote = rateFor === null ? undefined : Object.values(notesByPost).flat().find((note) => note.id === rateFor);

  return (
    <DemoContext.Provider value={state}>
      <div className="notes-app" ref={rootRef}>
        <div className="layout">
          <Rail />
          <main className="column">
            <SetupPanel />
            {route.name === 'timeline' ? <Timeline /> : <PostDetail postId={route.name === 'post' ? route.postId : START_POST_ID} />}
          </main>
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
        {signingIn && walletConfigured && signInHosts === 0 && (
          <SignInModal onClose={() => endSignIn(false)} onSignedIn={() => endSignIn(true)} />
        )}
        {/* A dialog shows the voice setup as its own step; the page card is for the gaps. */}
        {voicePhase && signInHosts === 0 && <WalletWait step={voicePhase} />}
        <BottomBar />
        <div className="toast-region" role="status" aria-live="polite">
          {toast && (
            <div key={toast.id} className="toast">
              {toast.text}
            </div>
          )}
        </div>
      </div>
    </DemoContext.Provider>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
