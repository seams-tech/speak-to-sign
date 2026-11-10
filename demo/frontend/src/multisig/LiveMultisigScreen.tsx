// The live voice multisig example for the Speak-to-Sign page (#/multisig). It draws a
// transaction queue in the style of a multisig wallet app (the sf-* classes of
// src/showcase/showcase.css), at 1120 × 700, and it works on NEAR testnet against the voice
// multisig contract (demo/contracts/voice-multisig, docs/voice-multisig.md):
//
// - Propose: the proposer types a transfer and reads it aloud; the contract gets its hash.
// - Confirm: a member says the transfer from memory; the page shows it with blanks.
// - Execute: at the threshold, the proposer's browser, which holds the salt, sends it.
//
// The page records the voice itself and asks /api/voice-verify. The Seams Wallet signs each
// contract call with its normal confirm step. If the contract is not deployed, the screen shows
// example data with a note. It needs SeamsWebProvider above it. `onSignIn` opens the page's
// sign-in dialog.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCircleDashed, IconCopy, IconListDetails, IconPlus, IconSend, IconUserCircle } from '@tabler/icons-react';
import { useSeams } from '@seams/wallet/react';
import { accountUrl, config, shortAccount } from '../config';
import { formatNear } from './intent';
import { createMultisigSigner } from './multisigSigner';
import { knownTransfer, ProposalBody, ProposePanel, proposalStatus, type MultisigContext } from './MultisigPanels';
import { getBalance, getConfig, getProposal, getProposals, nextProposalId, type MultisigConfig, type Proposal } from './views';
import './liveMultisig.css';

const POLL_MS = 1500;
const YOCTO_PER_HUNDREDTH = 10n ** 22n;

type Tab = 'queue' | 'history' | 'new';

/** The example that the screen shows while the contract is not deployed. */
const EXAMPLE_CONFIG: MultisigConfig = { members: ['alice.testnet', 'bob.testnet', 'carol.testnet'], threshold: 2, verifier_public_key: '' };
const EXAMPLE_PROPOSALS: Proposal[] = [
  { id: 7, commitment_hex: '4f2a6c1e9b0d3a5f7e2c8b1d4a6f9e0c3b5d7a2e4c6f8b0d1a3c5e7f9b2d91bd', proposer: 'alice.testnet', confirmations: ['alice.testnet'], status: 'open' },
  { id: 6, commitment_hex: '9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0', proposer: 'bob.testnet', confirmations: ['bob.testnet', 'carol.testnet'], status: 'executed', receiver: 'design.testnet', amount_yocto: '12000000000000000000000000' },
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
  const [tab, setTab] = useState<Tab>('queue');
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
    setLoaded({
      config: configResult.status === 'fulfilled' ? configResult.value : null,
      proposals,
      nextId: nextResult.status === 'fulfilled' ? nextResult.value : null,
      balance: balanceResult.status === 'fulfilled' ? balanceResult.value : null,
      error,
      missing: error !== null && /does not exist yet|no contract code/.test(error),
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
  const queue = proposals.filter((proposal) => proposal.status === 'open');
  const history = proposals.filter((proposal) => proposal.status !== 'open');
  const shown = tab === 'history' ? history : queue;
  const selected = openId ?? queue[0]?.id ?? null;
  const threshold = multisigConfig?.threshold ?? 0;

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
              <i>{multisigConfig?.members.includes(account) ? 'Member' : 'Not a member'}</i>
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
                {multisigConfig.threshold}/{multisigConfig.members.length}
              </i>
            )}
          </span>
          <div>
            <b>Team multisig</b>
            <span>
              <a href={accountUrl(contract)} target="_blank" rel="noopener noreferrer">
                {contract}
              </a>{' '}
              <IconCopy size={12} stroke={1.8} />
            </span>
          </div>
        </div>
        <p className="sf-total">{demo ? '1,250 NEAR' : loaded?.balance ? `${formatNear(Number(BigInt(loaded.balance) / YOCTO_PER_HUNDREDTH))} NEAR` : '— NEAR'}</p>
        <button type="button" className="sf-new lms-btn" onClick={() => setTab('new')}>
          <IconPlus size={16} stroke={2.2} /> New proposal
        </button>
        <nav className="sf-nav" aria-label="Multisig">
          <button type="button" className={tab !== 'new' ? 'sf-nav-on' : ''} onClick={() => setTab('queue')}>
            <IconListDetails size={20} stroke={1.6} /> Transactions {queue.length > 0 && <i className="sf-count">{queue.length}</i>}
          </button>
        </nav>
        {multisigConfig && (
          <div className="lms-members">
            <p className="sf-label">Members · {multisigConfig.threshold} must approve</p>
            {multisigConfig.members.map((member) => (
              <p key={member}>
                <IconUserCircle size={15} stroke={1.8} /> {shortAccount(member)}
                {member === account && <span className="sf-muted"> (you)</span>}
              </p>
            ))}
          </div>
        )}
      </aside>
      <main className="sf-main lms-main">
        <h1>Transactions</h1>
        <div className="sf-tabs" role="tablist">
          {(['queue', 'history', 'new'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'sf-tab-on' : ''} onClick={() => setTab(id)}>
              {id === 'queue' ? 'Queue' : id === 'history' ? 'History' : 'New proposal'}
            </button>
          ))}
        </div>
        {demo && <p className="lms-note">Contract not deployed yet. This is example data.</p>}
        {loaded?.error && !demo && (
          <p className="lms-error" role="alert">
            Cannot read the multisig: {loaded.error}
          </p>
        )}
        {tab === 'new' ? (
          <ProposePanel context={context} proposalId={nextId} />
        ) : !loaded ? (
          <p className="sf-label">Reading the multisig…</p>
        ) : shown.length === 0 ? (
          <p className="sf-label">{tab === 'queue' ? 'No open proposals. Make one with New proposal.' : 'No executed proposals yet.'}</p>
        ) : (
          <div className="lms-list">
            {shown.map((proposal) => {
              const status = proposalStatus(proposal, threshold);
              const transfer = knownTransfer(contract, proposal);
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
                    <span className="sf-kind">
                      <IconSend size={18} stroke={1.8} /> Send
                    </span>
                    <span className="sf-amount">
                      <i className="sf-token">N</i>
                      {transfer ? `−${transfer.amount} NEAR` : <span className="sf-muted">Hidden until executed</span>}
                    </span>
                    <span className="sf-time">{transfer ? `to ${shortAccount(transfer.receiver)}` : `by ${shortAccount(proposal.proposer)}`}</span>
                    <span className="sf-confs">
                      <IconUserCircle size={16} stroke={1.8} /> {proposal.confirmations.length} out of {threshold}
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
