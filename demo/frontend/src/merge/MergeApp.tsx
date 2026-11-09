import { useCallback, useEffect, useState } from 'react';
import {
  IconCheck,
  IconCircleFilled,
  IconCode,
  IconExternalLink,
  IconGitCommit,
  IconGitMerge,
  IconGitPullRequest,
  IconMicrophone,
} from '@tabler/icons-react';
import type { useSeams } from '@seams/wallet/react';
import { SignInModal } from '../components/SignInModal';
import { accountUrl, config, shortAccount, shortHash, transactionUrl } from '../config';
import { createSeamsSigner } from '../signer/seamsSigner';
import type { SignerStatus } from '../signer/notesSigner';
import { getApprovals, type Approval } from './approvals';
import { DEMO_PULL_REQUEST as PR, headCommit } from './data';
import { requestMergeApproval } from './mergeSigner';

type Seams = ReturnType<typeof useSeams>['seams'];

const HEAD = headCommit(PR);
const POLL_MS = 1500;

type Phase = { kind: 'open' } | { kind: 'signing' } | { kind: 'merged'; transactionHash: string; approver: string };

export function MergeApp({
  seams,
  walletId,
  nearAccountId,
}: {
  seams: Seams | null;
  walletId: string | null;
  nearAccountId: string | null;
}) {
  const [status, setStatus] = useState<SignerStatus>({ signedIn: false, voiceReady: false });
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'open' });
  const [message, setMessage] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const account = status.signedIn ? status.accountId : undefined;

  const refreshStatus = useCallback(async () => {
    if (!seams || !walletId) {
      setStatus({ signedIn: false, voiceReady: false });
      return;
    }
    try {
      setStatus(await createSeamsSigner({ seams, walletId, nearAccountId, contract: config.contract }).status());
    } catch {
      setStatus({ signedIn: true, accountId: nearAccountId ?? undefined, voiceReady: false });
    }
  }, [seams, walletId, nearAccountId]);

  const loadApprovals = useCallback(async (): Promise<Approval[]> => {
    try {
      const list = await getApprovals(config.rpcUrl, config.mergeContract, PR.repo, PR.number);
      setApprovals(list);
      setLoadError(null);
      return list;
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const onFocus = () => void refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshStatus]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const merge = async () => {
    setMessage(null);
    if (!account) {
      setSigningIn(true);
      return;
    }
    setPhase({ kind: 'signing' });
    const result = await requestMergeApproval(seams, walletId, config.mergeContract, {
      repo: PR.repo,
      pullRequest: PR.number,
      base: PR.base,
      headCommit: HEAD,
    });
    switch (result.kind) {
      case 'sent': {
        setPhase({ kind: 'merged', transactionHash: result.transactionHash, approver: account });
        // Read the contract until the approval shows.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const list = await loadApprovals();
          if (list.some((approval) => approval.approver === account && approval.head_commit === HEAD)) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        return;
      }
      case 'cancelled':
        setPhase({ kind: 'open' });
        setMessage('You closed the Wallet card. Nothing was signed.');
        return;
      case 'refused':
      case 'unavailable':
        setPhase({ kind: 'open' });
        setMessage(result.reason);
        return;
    }
  };

  const merged = phase.kind === 'merged';

  return (
    <div className="pr-page">
      <p className="pr-banner">
        <IconMicrophone size={16} stroke={2} aria-hidden="true" />
        <span>
          A demo pull request. <b>Merge with voice</b> records a voice-signed approval on NEAR testnet; nothing in the
          repository changes. <a href="/">What is Speak-to-Sign?</a>
        </span>
      </p>

      <header className="pr-top">
        <IconCode size={22} stroke={1.8} aria-hidden="true" />
        <span className="pr-repo">
          {PR.repo.split('/')[0]} / <b>{PR.repo.split('/')[1]}</b>
        </span>
        <span className="pr-top-end">
          {account ? (
            <span className="pr-me" title={account}>
              <span className="pr-me-avatar" aria-hidden="true">
                {account.charAt(0).toUpperCase()}
              </span>
              {shortAccount(account)}
            </span>
          ) : (
            <button type="button" className="pr-btn" onClick={() => setSigningIn(true)} disabled={!seams}>
              Sign in
            </button>
          )}
        </span>
      </header>
      <nav className="pr-repo-tabs" aria-label="Repository">
        <span>Code</span>
        <span>Issues</span>
        <span className="pr-on" aria-current="page">
          Pull requests
        </span>
        <span>Actions</span>
      </nav>

      <main className="pr-body">
        <h1 className="pr-title">
          {PR.title} <span className="pr-num">#{PR.number}</span>
        </h1>
        <div className="pr-state">
          {merged ? (
            <span className="pr-pill pr-pill-merged">
              <IconGitMerge size={16} stroke={2} aria-hidden="true" /> Merged
            </span>
          ) : (
            <span className="pr-pill pr-pill-open">
              <IconGitPullRequest size={16} stroke={2} aria-hidden="true" /> Open
            </span>
          )}
          <span className="pr-muted">
            <b className="pr-ink">{PR.author}</b> wants to merge {PR.commits.length} commits into <code>{PR.base}</code> from{' '}
            <code>{PR.branch}</code>
          </span>
        </div>
        <div className="pr-tabs">
          <span className="pr-on">Conversation</span>
          <span>Commits {PR.commits.length}</span>
          <span>Checks 3</span>
          <span>Files changed {PR.files}</span>
          <span className="pr-diff">
            <b className="pr-add">+{PR.additions}</b> <b className="pr-del">−{PR.deletions}</b>
          </span>
        </div>

        <div className="pr-grid">
          <div className="pr-main">
            <div className="pr-comment">
              <span className="pr-avatar" aria-hidden="true">
                {PR.author.charAt(0).toUpperCase()}
              </span>
              <div className="pr-bubble">
                <div className="pr-bubble-head">
                  <b>{PR.author}</b> commented
                </div>
                <p>{PR.body}</p>
              </div>
            </div>

            <ul className="pr-events">
              {PR.commits.map((commit) => (
                <li key={commit.sha}>
                  <IconGitCommit size={16} stroke={1.8} aria-hidden="true" />
                  <span>{commit.message}</span>
                  <code>{commit.sha.slice(0, 7)}</code>
                </li>
              ))}
              <li>
                <span className="pr-dot pr-dot-ok" aria-hidden="true">
                  <IconCheck size={12} stroke={3} />
                </span>
                <span>
                  <b>{PR.reviewer}</b> approved these changes
                </span>
              </li>
              {[...approvals].reverse().map((approval) => (
                <li key={approval.id} className="pr-event-voice">
                  <span className="pr-dot pr-dot-voice" aria-hidden="true">
                    <IconMicrophone size={12} stroke={2.4} />
                  </span>
                  <span>
                    <a href={accountUrl(approval.approver)} target="_blank" rel="noopener noreferrer">
                      <b>{shortAccount(approval.approver)}</b>
                    </a>{' '}
                    approved merging <code>{approval.head_commit.slice(0, 7)}</code> into <code>{approval.base}</code> by voice
                    <span className="pr-muted"> · {timeAgo(approval.approved_at_ms)}</span>
                  </span>
                </li>
              ))}
            </ul>

            {merged ? (
              <MergedBox phase={phase} />
            ) : (
              <div className="pr-merge">
                <Row ok title="Changes approved" detail={`1 approving review by ${PR.reviewer}`} />
                <Row ok title="All checks have passed" detail="build · test · lint" />
                <Row
                  ok={false}
                  title="Maintainer voice approval"
                  detail="Required. The Seams Wallet shows one sentence, for example “merge pull request four hundred twelve into main”. Say it to sign."
                />
                <div className="pr-merge-foot">
                  <button type="button" className="pr-btn pr-btn-merge" onClick={() => void merge()} disabled={phase.kind === 'signing'}>
                    <IconGitMerge size={16} stroke={2} aria-hidden="true" />
                    {phase.kind === 'signing' ? 'Waiting for your voice…' : account ? 'Merge with voice' : 'Sign in to merge'}
                  </button>
                  <span className="pr-muted">
                    The Wallet signs <code>approve_merge</code> for commit <code>{HEAD.slice(0, 7)}</code>, from your own account.
                  </span>
                </div>
                {message && (
                  <p className="pr-message" role="alert">
                    {message}
                  </p>
                )}
              </div>
            )}
          </div>

          <aside className="pr-side">
            <section>
              <h2>Reviewers</h2>
              <p>
                {PR.reviewer} <IconCheck size={14} stroke={2.5} className="pr-ok" aria-label="approved" />
              </p>
            </section>
            <section>
              <h2>Required approval</h2>
              <p>A maintainer, by voice (Speak-to-Sign)</p>
            </section>
            <section>
              <h2>Your Seams Wallet</h2>
              {account ? (
                <p>
                  {shortAccount(account)} · VoiceID {status.voiceReady ? 'on' : 'off'}
                </p>
              ) : (
                <p className="pr-muted">Not signed in</p>
              )}
              <p className="pr-small">
                First time? <a href="/notes/">Set up your voice</a> once in the Community Notes demo. It is the same wallet.
              </p>
            </section>
            <section>
              <h2>Approvals contract</h2>
              <p>
                <a href={accountUrl(config.mergeContract)} target="_blank" rel="noopener noreferrer">
                  <code>{config.mergeContract}</code>
                </a>
              </p>
              {loadError && <p className="pr-small pr-error">Cannot read approvals: {loadError}</p>}
            </section>
          </aside>
        </div>
      </main>

      {signingIn && seams && (
        <SignInModal
          intro="Your merge approval is signed from your own NEAR testnet account. Use a passkey to sign in, or create a new wallet."
          onClose={() => setSigningIn(false)}
          onSignedIn={() => {
            setSigningIn(false);
            void refreshStatus();
          }}
        />
      )}
    </div>
  );
}

function Row({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="pr-row">
      <span className={`pr-dot ${ok ? 'pr-dot-ok' : 'pr-dot-wait'}`} aria-hidden="true">
        {ok ? <IconCheck size={13} stroke={3} /> : <IconCircleFilled size={9} />}
      </span>
      <div>
        <b>{title}</b>
        <span className="pr-muted">{detail}</span>
      </div>
    </div>
  );
}

function MergedBox({ phase }: { phase: Extract<Phase, { kind: 'merged' }> }) {
  return (
    <div className="pr-merged" role="status">
      <span className="pr-merged-icon" aria-hidden="true">
        <IconGitMerge size={20} stroke={2} />
      </span>
      <div>
        <b>Pull request merged by voice</b>
        <p>
          {shortAccount(phase.approver)} said the sentence, the verifier accepted the voice and the words, and the Seams Wallet
          signed <code>approve_merge</code> for commit <code>{HEAD.slice(0, 7)}</code> into <code>{PR.base}</code>.{' '}
          <a href={transactionUrl(phase.transactionHash)} target="_blank" rel="noopener noreferrer">
            Tx {shortHash(phase.transactionHash)} <IconExternalLink size={13} stroke={2} aria-hidden="true" />
          </a>
        </p>
        <p className="pr-small pr-muted">Demo: the approval is on NEAR testnet. Nothing in the repository changed.</p>
        <button type="button" className="pr-btn" onClick={() => window.location.reload()}>
          Reset the demo
        </button>
      </div>
    </div>
  );
}

function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
