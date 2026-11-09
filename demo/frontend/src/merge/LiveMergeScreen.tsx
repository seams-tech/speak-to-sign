// The live PR merge example for the Speak-to-Sign page (/). It draws the same pull request
// page as the showcase's MergeScreen (the gh-* classes of src/showcase/showcase.css), at
// 1120 × 700 inside ScaledScreen, but its merge box works: "Merge with voice" asks the Seams
// Wallet for a spoken approval, and the Wallet signs `approve_merge` on the merge approvals
// contract. Nothing in a repository changes; the on-chain approval is the signed merge message.
//
// It needs SeamsWebProvider above it. `onSignIn` opens the page's sign-in dialog.

import { useCallback, useEffect, useState } from 'react';
import {
  IconCheck,
  IconCircleDashed,
  IconCode,
  IconExternalLink,
  IconGitMerge,
  IconGitPullRequest,
  IconMicrophone,
} from '@tabler/icons-react';
import { useSeams } from '@seams/wallet/react';
import { accountUrl, config, shortAccount, shortHash, transactionUrl } from '../config';
import { getApprovals, type Approval } from './approvals';
import { DEMO_PULL_REQUEST as PR, headCommit } from './data';
import { requestMergeApproval } from './mergeSigner';
import './liveMerge.css';

const HEAD = headCommit(PR);
const POLL_MS = 1500;

type Phase = { kind: 'open' } | { kind: 'signing' } | { kind: 'merged'; transactionHash: string; approver: string };

export function LiveMergeScreen({ say, onSignIn }: { say: string; onSignIn?: () => void }) {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const account = walletId ? (loginState.nearAccountId ?? undefined) : undefined;

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'open' });
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Approval[]> => {
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
    void load();
  }, [load]);

  const merge = async () => {
    setMessage(null);
    if (!account) {
      if (onSignIn) onSignIn();
      else setMessage('Sign in to Seams Wallet first.');
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
      case 'sent':
        setPhase({ kind: 'merged', transactionHash: result.transactionHash, approver: account });
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const list = await load();
          if (list.some((approval) => approval.approver === account && approval.head_commit === HEAD)) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        return;
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
  const [owner, name] = PR.repo.split('/');
  const recent = approvals.slice(0, 2);

  return (
    <div className="gh lm">
      <header className="gh-header">
        <span className="gh-logo" aria-hidden="true">
          <IconCircleDashed size={30} stroke={1.6} />
        </span>
        <span className="gh-crumbs">
          <span>{owner}</span>
          <span className="gh-slash">/</span>
          <b>{name}</b>
        </span>
        <span className="lm-header-end">
          {account ? (
            <span className="lm-me" title={account}>
              <span className="gh-avatar gh-avatar-sm" aria-hidden="true">
                {account.charAt(0).toLowerCase()}
              </span>
              {shortAccount(account)}
            </span>
          ) : (
            <button type="button" className="gh-btn lm-btn" onClick={onSignIn} disabled={!onSignIn}>
              Sign in
            </button>
          )}
        </span>
      </header>
      <nav className="gh-reponav" aria-label="Repository">
        <span>
          <IconCode size={16} stroke={2} /> Code
        </span>
        <span className="gh-reponav-on">
          <IconGitPullRequest size={16} stroke={2} /> Pull requests <i className="gh-counter">1</i>
        </span>
      </nav>
      <div className="gh-page">
        <div className="gh-titlerow">
          <h1>
            {PR.title} <span className="gh-num">#{PR.number}</span>
          </h1>
        </div>
        <div className="gh-meta">
          {merged ? (
            <span className="gh-state lm-state-merged">
              <IconGitMerge size={16} stroke={2} /> Merged
            </span>
          ) : (
            <span className="gh-state">
              <IconGitPullRequest size={16} stroke={2} /> Open
            </span>
          )}
          <span>
            <b>{PR.author}</b> wants to merge {PR.commits.length} commits into <span className="gh-branch">{PR.base}</span> from{' '}
            <span className="gh-branch">
              {PR.author}:{PR.branch}
            </span>
          </span>
        </div>
        <div className="gh-tabnav">
          <span className="gh-tab gh-tab-on">Conversation</span>
          <span className="gh-tab">
            Commits <i className="gh-counter">{PR.commits.length}</i>
          </span>
          <span className="gh-tab">
            Files changed <i className="gh-counter">{PR.files}</i>
          </span>
          <span className="gh-diffstat">
            <b className="gh-add">+{PR.additions}</b> <b className="gh-del">−{PR.deletions}</b>
          </span>
        </div>
        <div className="gh-layout">
          <div className="gh-discussion">
            <div className="gh-comment">
              <span className="gh-avatar">{PR.author.charAt(0)}</span>
              <div className="gh-box">
                <div className="gh-box-head">
                  <span>
                    <b>{PR.author}</b> commented
                  </span>
                  <span className="gh-label-pill">Author</span>
                </div>
                <div className="gh-box-body">
                  <p>{PR.body}</p>
                </div>
              </div>
            </div>
            <div className="gh-item">
              <span className="gh-badge gh-badge-ok">
                <IconCheck size={14} stroke={3} />
              </span>
              <span className="gh-avatar gh-avatar-xs">{PR.reviewer.charAt(0)}</span>
              <b>{PR.reviewer}</b> approved these changes
            </div>
            {[...recent].reverse().map((approval) => (
              <div className="gh-item" key={approval.id}>
                <span className="gh-badge lm-badge-voice">
                  <IconMicrophone size={13} stroke={2.4} />
                </span>
                <span>
                  <a href={accountUrl(approval.approver)} target="_blank" rel="noopener noreferrer">
                    <b>{shortAccount(approval.approver)}</b>
                  </a>{' '}
                  approved merging <span className="gh-branch">{approval.head_commit.slice(0, 7)}</span> by voice
                </span>
              </div>
            ))}

            <div className="gh-mergebox">
              <span className={`gh-mergeicon ${merged ? 'lm-mergeicon-merged' : ''}`}>
                <IconGitMerge size={20} stroke={2} />
              </span>
              <div className="gh-box">
                {merged ? (
                  <div className="lm-merged" role="status">
                    <b>Pull request merged by voice</b>
                    <p>
                      {shortAccount(phase.approver)} said the sentence, the verifier accepted the voice and the words, and the
                      Seams Wallet signed <code>approve_merge</code> for <span className="gh-branch">{HEAD.slice(0, 7)}</span>.{' '}
                      <a href={transactionUrl(phase.transactionHash)} target="_blank" rel="noopener noreferrer">
                        Tx {shortHash(phase.transactionHash)} <IconExternalLink size={13} stroke={2} />
                      </a>
                    </p>
                    <p className="gh-muted">A demo: the approval is on NEAR testnet; no repository changed.</p>
                    <button type="button" className="gh-btn lm-btn" onClick={() => setPhase({ kind: 'open' })}>
                      Run it again
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="gh-mrow">
                      <span className="gh-dot gh-dot-ok">
                        <IconCheck size={14} stroke={3} />
                      </span>
                      <div>
                        <b>Changes approved</b>
                        <span>1 approving review by {PR.reviewer}.</span>
                      </div>
                    </div>
                    <div className="gh-mrow">
                      <span className="gh-dot gh-dot-wait" />
                      <div>
                        <b>speak-to-sign / maintainer-voice</b>
                        <span>
                          Press Merge with voice, then say “{say}”.
                        </span>
                      </div>
                      <span className="gh-required">Required</span>
                    </div>
                    <div className="gh-mfoot">
                      <button
                        type="button"
                        className="gh-btn gh-btn-primary lm-btn"
                        onClick={() => void merge()}
                        disabled={phase.kind === 'signing'}
                      >
                        <IconMicrophone size={16} stroke={2} />
                        {phase.kind === 'signing' ? 'Waiting for your voice…' : account ? 'Merge with voice' : 'Sign in to merge'}
                      </button>
                      <span className="gh-muted">
                        Signs <code>approve_merge</code> for {HEAD.slice(0, 7)} from your own account.
                      </span>
                    </div>
                    {message && (
                      <p className="lm-message" role="alert">
                        {message}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <aside className="gh-sidebar">
            <div>
              <h3>Reviewers</h3>
              <p>
                <span className="gh-avatar gh-avatar-xs">{PR.reviewer.charAt(0)}</span> {PR.reviewer}{' '}
                <IconCheck size={14} stroke={2.5} className="gh-ok" />
              </p>
            </div>
            <div>
              <h3>Required approval</h3>
              <p>Maintainer, by voice</p>
            </div>
            <div>
              <h3>Approvals contract</h3>
              <p>
                <a href={accountUrl(config.mergeContract)} target="_blank" rel="noopener noreferrer">
                  {config.mergeContract}
                </a>
              </p>
              {loadError && <p className="lm-error">Cannot read approvals: {loadError}</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
