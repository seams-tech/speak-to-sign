// A concept screen drawn in the style of the real app (a multisig wallet's transaction queue on
// NEAR), with neutral logo slots. It fills a fixed screen that ScaledScreen shrinks, and sits
// inside a DrawnFrame so it reads as an example.

import {
  IconAddressBook,
  IconBell,
  IconBook,
  IconCheck,
  IconCircleDashed,
  IconCoins,
  IconCopy,
  IconHome,
  IconListDetails,
  IconSend,
  IconSettings,
  IconUserCircle,
} from '@tabler/icons-react';
import { WalletVoiceCard } from './frame';

/**
 * A transaction queue in the style of a multisig wallet app, on NEAR testnet. The amount and
 * the receiver are hidden: a member says them from memory. The live screen is
 * src/multisig/LiveMultisigScreen.tsx; this drawing stands in for it without a Seams key.
 */
export function MultisigScreen() {
  return (
    <div className="sf">
      <header className="sf-header">
        <span className="sf-logo" aria-hidden="true">
          <IconCircleDashed size={26} stroke={1.6} />
        </span>
        <span className="sf-header-gap" />
        <span className="sf-pill">
          <IconBook size={16} stroke={1.8} /> Help
        </span>
        <span className="sf-pill">
          <IconBell size={16} stroke={1.8} />
        </span>
        <span className="sf-pill sf-network">
          <i className="sf-netdot" /> NEAR testnet
        </span>
        <span className="sf-pill sf-wallet">
          <span className="sf-identicon sf-identicon-c" />
          <span>
            <b>bob.testnet</b>
            <i>Member</i>
          </span>
        </span>
      </header>
      <aside className="sf-side">
        <div className="sf-acct">
          <span className="sf-identicon sf-identicon-a">
            <i className="sf-threshold">2/3</i>
          </span>
          <div>
            <b>Team multisig</b>
            <span>
              team.seams-v1.testnet <IconCopy size={12} stroke={1.8} />
            </span>
          </div>
        </div>
        <p className="sf-total">1,250 NEAR</p>
        <span className="sf-new">New proposal</span>
        <nav className="sf-nav">
          <span>
            <IconHome size={20} stroke={1.6} /> Home
          </span>
          <span>
            <IconCoins size={20} stroke={1.6} /> Assets
          </span>
          <span className="sf-nav-on">
            <IconListDetails size={20} stroke={1.6} /> Transactions <i className="sf-count">1</i>
          </span>
          <span>
            <IconAddressBook size={20} stroke={1.6} /> Members
          </span>
          <span>
            <IconSettings size={20} stroke={1.6} /> Settings
          </span>
        </nav>
      </aside>
      <main className="sf-main">
        <h1>Transactions</h1>
        <div className="sf-tabs">
          <span className="sf-tab-on">Queue</span>
          <span>History</span>
          <span>New proposal</span>
        </div>
        <p className="sf-label">Next proposal</p>
        <div className="sf-tx">
          <div className="sf-txrow">
            <span className="sf-nonce">7</span>
            <span className="sf-kind">
              <IconSend size={18} stroke={1.8} /> Send
            </span>
            <span className="sf-amount">
              <i className="sf-token">N</i> <span className="sf-muted">Hidden until executed</span>
            </span>
            <span className="sf-time">2:15 PM</span>
            <span className="sf-confs">
              <IconUserCircle size={16} stroke={1.8} /> 1 out of 2
            </span>
            <span className="sf-status">Needs confirmation</span>
          </div>
          <div className="sf-txbody">
            <div className="sf-details">
              <p>
                Send <b>___</b> NEAR to <b>___</b>
              </p>
              <p className="sf-muted">The chain holds only a salted hash of the transfer. Each member says it from memory.</p>
              <dl>
                <dt>Proposal</dt>
                <dd>7</dd>
                <dt>Proposer</dt>
                <dd>alice.testnet</dd>
                <dt>Commitment</dt>
                <dd>4f2a6c1e9b…2d91bd</dd>
              </dl>
            </div>
            <div className="sf-steps">
              <p className="sf-step sf-step-done">
                <span className="sf-stepdot">
                  <IconCheck size={12} stroke={3} />
                </span>
                Proposed
              </p>
              <p className="sf-step sf-step-done">
                <span className="sf-stepdot">
                  <IconCheck size={12} stroke={3} />
                </span>
                Confirmations <span className="sf-muted">(1 of 2)</span>
              </p>
              <p className="sf-owner">
                <span className="sf-identicon sf-identicon-a sf-identicon-xs" /> alice.testnet
              </p>
              <p className="sf-owner sf-owner-wait">
                <span className="sf-identicon sf-identicon-c sf-identicon-xs" /> bob.testnet <span className="sf-muted">(you)</span>
              </p>
              <p className="sf-step">
                <span className="sf-stepdot sf-stepdot-wait" />
                The proposer executes it at the threshold
              </p>
              <div className="sf-btns">
                <span className="sf-btn">Confirm by voice</span>
              </div>
            </div>
          </div>
        </div>
      </main>
      <div className="ss-overlay-card">
        <WalletVoiceCard say="approve proposal seven, send ___ NEAR to ___" compact />
      </div>
    </div>
  );
}
