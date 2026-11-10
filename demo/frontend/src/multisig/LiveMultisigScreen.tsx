// The live voice multisig example, on its own page (/multisig/, window #/multisig). It draws the
// transactions of a multisig wallet app (the sf-* classes of src/showcase/showcase.css), at
// 1120 × 700, and it works on NEAR testnet against the voice multisig contract
// (demo/contracts/voice-multisig, docs/voice-intents-spec.md). It opens on the New proposal
// tab; the History tab lists the open and the executed proposals, newest first.
//
// - Propose: the visitor types a transfer and reads it aloud; the contract gets its hash.
// - Approve: the page sends the opening to /api/multisig/approve. The two admin signers approve
//   with their keys, and admin B executes the transfer. The page shows them as signers like the
//   visitor, with no words about keys.
//
// The page records the voice itself and asks /api/voice-verify. The Seams Wallet signs `propose`
// with its normal confirm step. If the contract is not deployed, the screen shows example data
// with a note. It needs SeamsWebProvider above it. `onSignIn` opens the page's sign-in dialog.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCircleDashed, IconCopy, IconEyeOff, IconListDetails, IconPlus, IconSend, IconUserCircle } from '@tabler/icons-react';
import { useSeams } from '@seams/wallet/react';
import { accountUrl, config, shortAccount } from '../config';
import { formatNear } from './intent';
import { createMultisigSigner } from './multisigSigner';
import { adminName, knownProposal, ProposalBody, ProposePanel, proposalStatus, type MultisigContext } from './MultisigPanels';
import { readOpening, removeOpening } from './openings';
import type { MultisigConfig, Proposal } from './contractViews';
import { getBalance, getConfig, getProposal, getProposals, isMissingContract, nextProposalId } from './views';
import './liveMultisig.css';

const POLL_MS = 1500;
const YOCTO_PER_HUNDREDTH = 10n ** 22n;

type Tab = 'new' | 'history';

/** The example that the screen shows while the contract is not deployed. */
const EXAMPLE_ADMINS = ['admin-a.seams-v1.testnet', 'admin-b.seams-v1.testnet'];
const EXAMPLE_CONFIG: MultisigConfig = { admins: EXAMPLE_ADMINS, verifier_public_key: '' };
const EXAMPLE_PROPOSALS: Proposal[] = [
  {
    id: 7,
    commitment_hex: '4f2a6c1e9b0d3a5f7e2c8b1d4a6f9e0c3b5d7a2e4c6f8b0d1a3c5e7f9b2d91bd',
    proposer: 'visitor.testnet',
    approvals: ['admin-a.seams-v1.testnet'],
    status: 'open',
    created_at_ms: Date.UTC(2026, 10, 10, 5, 15),
  },
  {
    id: 6,
    commitment_hex: '9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
    proposer: 'guest.testnet',
    approvals: EXAMPLE_ADMINS,
    status: 'executed',
    created_at_ms: Date.UTC(2026, 10, 10, 4, 2),
    receiver: 'seams-grants.testnet',
    amount_yocto: '10000000000000000000000',
  },
];

interface Loaded {
  config: MultisigConfig | null;
  proposals: Proposal[];
  nextId: number | null;
  balance: string | null;
  error: string | null;
  /** The contract account or its code is missing. */
  missing: boolean;
}

export function LiveMultisigScreen({ onSignIn }: { onSignIn?: () => void }) {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const account = walletId ? (loginState.nearAccountId ?? undefined) : undefined;
  const contract = config.multisigContract;
  const signer = useMemo(() => createMultisigSigner({ seams, walletId, contract }), [seams, walletId, contract]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('new');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async (): Promise<Proposal[]> => {
    const [configResult, proposalsResult, nextResult, balanceResult] = await Promise.allSettled([
      getConfig(config.rpcUrl, contract),
      getProposals(config.rpcUrl, contract),
      nextProposalId(config.rpcUrl, contract),
      getBalance(config.rpcUrl, contract),
    ]);
    const failed = [configResult, proposalsResult, nextResult].find((result) => result.status === 'rejected');
    const error = failed?.status === 'rejected' ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null;
    const proposals = proposalsResult.status === 'fulfilled' ? proposalsResult.value : [];
    // The opening is needed only until the transfer is executed.
    for (const proposal of proposals) if (proposal.status === 'executed') removeOpening(contract, proposal.id);
    setLoaded({
      config: configResult.status === 'fulfilled' ? configResult.value : null,
      proposals,
      nextId: nextResult.status === 'fulfilled' ? nextResult.value : null,
      balance: balanceResult.status === 'fulfilled' ? balanceResult.value : null,
      error,
      missing: error !== null && isMissingContract(error),
    });
    return proposals;
  }, [contract]);

  useEffect(() => {
    void load();
  }, [load]);

  // After a transaction, read the proposal until the contract shows the change.
  const onSent = useCallback(
    (proposalId: number) => {
      const before = JSON.stringify(loaded?.proposals.find((proposal) => proposal.id === proposalId) ?? null);
      void (async () => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const fresh = await getProposal(config.rpcUrl, contract, proposalId).catch(() => null);
          if (fresh && JSON.stringify(fresh) !== before) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        await load();
      })();
    },
    [contract, load, loaded],
  );

  const demo = loaded?.missing ?? false;
  const multisigConfig = demo ? EXAMPLE_CONFIG : (loaded?.config ?? null);
  const proposals = demo ? EXAMPLE_PROPOSALS : (loaded?.proposals ?? []);
  const nextId = demo ? 8 : (loaded?.nextId ?? null);
  const open = proposals.filter((proposal) => proposal.status === 'open');
  // At first, the newest open proposal whose opening this browser holds: it can finish the transfer.
  const held = open.find((proposal) => readOpening(contract, proposal.id)?.commitment_hex === proposal.commitment_hex);
  const selected = openId ?? held?.id ?? null;
  const admins = multisigConfig?.admins ?? [];

  const context: MultisigContext = { contract, account, config: multisigConfig, demo, signer, onSignIn, onSent };

  return (
    <div className="sf lms">
      <header className="sf-header">
        <span className="sf-logo" aria-hidden="true">
          <IconCircleDashed size={26} stroke={1.6} />
        </span>
        <span className="sf-header-gap" />
        <span className="sf-pill sf-network">
          <i className="sf-netdot" /> NEAR testnet
        </span>
        {account ? (
          <span className="sf-pill sf-wallet" title={account}>
            <span className="sf-identicon sf-identicon-c" />
            <span>
              <b>{shortAccount(account)}</b>
              <i>{admins.includes(account) ? 'Signer' : 'Proposer'}</i>
            </span>
          </span>
        ) : (
          <button type="button" className="sf-btn lms-btn lms-btn-sm" onClick={onSignIn} disabled={!onSignIn}>
            Sign in
          </button>
        )}
      </header>
      <aside className="sf-side">
        <div className="sf-acct">
          <span className="sf-identicon sf-identicon-a">
            {multisigConfig && (
              <i className="sf-threshold">
                {admins.length}/{admins.length}
              </i>
            )}
          </span>
          <div>
            <b>Notes moderators</b>
            <span>
              <a href={accountUrl(contract)} target="_blank" rel="noopener noreferrer">
                {contract}
              </a>{' '}
              <IconCopy size={12} stroke={1.8} />
            </span>
          </div>
        </div>
        <p className="sf-total">{demo ? '10 NEAR' : loaded?.balance ? `${formatNear(Number(BigInt(loaded.balance) / YOCTO_PER_HUNDREDTH))} NEAR` : '— NEAR'}</p>
        <button type="button" className="sf-new lms-btn" onClick={() => setTab('new')}>
          <IconPlus size={16} stroke={2.2} /> New proposal
        </button>
        <nav className="sf-nav" aria-label="Multisig">
          <button type="button" className="sf-nav-on" onClick={() => setTab('history')}>
            <IconListDetails size={20} stroke={1.6} /> Transactions {open.length > 0 && <i className="sf-count">{open.length}</i>}
          </button>
        </nav>
        {multisigConfig && (
          <div className="lms-members">
            <p className="sf-label">Signers · all approve</p>
            {admins.map((admin, index) => (
              <p key={admin} className="lms-signer" title={admin}>
                <span className={`sf-identicon sf-identicon-xs ${index % 2 === 0 ? 'sf-identicon-a' : 'sf-identicon-b'}`} aria-hidden="true" />
                <span>
                  {adminName(index)}
                  <i>{shortAccount(admin)}</i>
                </span>
              </p>
            ))}
          </div>
        )}
      </aside>
      <main className="sf-main lms-main">
        <h1>Transactions</h1>
        <div className="sf-tabs" role="tablist">
          {(['new', 'history'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'sf-tab-on' : ''} onClick={() => setTab(id)}>
              {id === 'new' ? 'New proposal' : 'History'}
            </button>
          ))}
        </div>
        {demo && <p className="lms-note">Contract not deployed yet. This is example data.</p>}
        {loaded?.error && !demo && (
          <p className="lms-error" role="alert">
            {loaded.error}
          </p>
        )}
        {tab === 'new' ? (
          <ProposePanel context={context} proposalId={nextId} />
        ) : !loaded ? (
          <p className="sf-label">Reading the multisig…</p>
        ) : proposals.length === 0 ? (
          <p className="sf-label">No proposals yet. Make one with New proposal.</p>
        ) : (
          <div className="lms-list">
            {proposals.map((proposal) => {
              const status = proposalStatus(proposal, admins.length);
              const known = knownProposal(contract, proposal);
              const expanded = proposal.status === 'open' && proposal.id === selected;
              return (
                <div className="sf-tx" key={proposal.id}>
                  <button
                    type="button"
                    className="sf-txrow lms-txrow"
                    aria-expanded={proposal.status === 'open' ? expanded : undefined}
                    onClick={() => setOpenId(expanded ? -1 : proposal.id)}
                  >
                    <span className="sf-nonce">{proposal.id}</span>
                    {known?.kind === 'hide' ? (
                      <>
                        <span className="sf-kind">
                          <IconEyeOff size={18} stroke={1.8} /> Hide
                        </span>
                        <span className="sf-amount">Note {known.noteId}</span>
                        <span className="sf-time">by {shortAccount(proposal.proposer)}</span>
                      </>
                    ) : (
                      <>
                        <span className="sf-kind">
                          {known ? <IconSend size={18} stroke={1.8} /> : <IconCircleDashed size={18} stroke={1.8} />} {known ? 'Send' : 'Proposal'}
                        </span>
                        <span className="sf-amount">
                          {known ? (
                            <>
                              <i className="sf-token">N</i>−{known.amount} NEAR
                            </>
                          ) : (
                            <span className="sf-muted">Hidden until executed</span>
                          )}
                        </span>
                        <span className="sf-time">{known ? `to ${shortAccount(known.receiver)}` : `by ${shortAccount(proposal.proposer)}`}</span>
                      </>
                    )}
                    <span className="sf-confs">
                      <IconUserCircle size={16} stroke={1.8} /> {proposal.approvals.length} of {admins.length} signers
                    </span>
                    <span className={`sf-status lms-status-${status.tone}`}>{status.text}</span>
                  </button>
                  {expanded && <ProposalBody key={`${proposal.id}:${account ?? ''}`} context={context} proposal={proposal} />}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
