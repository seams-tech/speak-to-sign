// Concept screens drawn in the style of the real apps (a code host's pull request page and a
// multisig wallet's transaction queue on NEAR), with neutral logo slots. Each fills a fixed screen that
// ScaledScreen shrinks, and sits inside a DrawnFrame so it reads as an example.

import {
  IconAddressBook,
  IconBell,
  IconBook,
  IconCaretDownFilled,
  IconChartLine,
  IconCheck,
  IconCircleDashed,
  IconCircleDot,
  IconCode,
  IconCoins,
  IconCopy,
  IconDots,
  IconGitMerge,
  IconGitPullRequest,
  IconHome,
  IconListDetails,
  IconMenu2,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconSend,
  IconSettings,
  IconShield,
  IconTable,
  IconUserCircle,
} from '@tabler/icons-react';
import { WalletVoiceCard } from './frame';

/** A pull request page in the style of a code host (Primer-like light theme). */
export function MergeScreen({ say }: { say: string }) {
  return (
    <div className="gh">
      <header className="gh-header">
        <span className="gh-iconbtn">
          <IconMenu2 size={16} stroke={2} />
        </span>
        <span className="gh-logo" aria-hidden="true">
          <IconCircleDashed size={30} stroke={1.6} />
        </span>
        <span className="gh-crumbs">
          <span>seams-tech</span>
          <span className="gh-slash">/</span>
          <b>speak-to-sign</b>
        </span>
        <span className="gh-search">
          <IconSearch size={14} stroke={2} />
          Type <kbd>/</kbd> to search
        </span>
        <span className="gh-iconbtn">
          <IconPlus size={16} stroke={2} />
          <IconCaretDownFilled size={10} />
        </span>
        <span className="gh-iconbtn">
          <IconCircleDot size={16} stroke={2} />
        </span>
        <span className="gh-iconbtn">
          <IconGitPullRequest size={16} stroke={2} />
        </span>
        <span className="gh-iconbtn">
          <IconBell size={16} stroke={2} />
        </span>
        <span className="gh-avatar gh-avatar-sm">m</span>
      </header>
      <nav className="gh-reponav">
        <span>
          <IconCode size={16} stroke={2} /> Code
        </span>
        <span>
          <IconCircleDot size={16} stroke={2} /> Issues <i className="gh-counter">3</i>
        </span>
        <span className="gh-reponav-on">
          <IconGitPullRequest size={16} stroke={2} /> Pull requests <i className="gh-counter">1</i>
        </span>
        <span>
          <IconPlayerPlay size={16} stroke={2} /> Actions
        </span>
        <span>
          <IconTable size={16} stroke={2} /> Projects
        </span>
        <span>
          <IconShield size={16} stroke={2} /> Security
        </span>
        <span>
          <IconChartLine size={16} stroke={2} /> Insights
        </span>
        <span>
          <IconSettings size={16} stroke={2} /> Settings
        </span>
      </nav>
      <div className="gh-page">
        <div className="gh-titlerow">
          <h1>
            Fix fee rounding in transfer <span className="gh-num">#412</span>
          </h1>
          <span className="gh-btn">Edit</span>
          <span className="gh-btn gh-btn-primary">
            <IconCode size={16} stroke={2} /> Code <IconCaretDownFilled size={10} />
          </span>
        </div>
        <div className="gh-meta">
          <span className="gh-state">
            <IconGitPullRequest size={16} stroke={2} /> Open
          </span>
          <span>
            <b>alice</b> wants to merge 3 commits into <span className="gh-branch">main</span> from{' '}
            <span className="gh-branch">alice:fix/fee-rounding</span>
          </span>
        </div>
        <div className="gh-tabnav">
          <span className="gh-tab gh-tab-on">
            Conversation <i className="gh-counter">4</i>
          </span>
          <span className="gh-tab">
            Commits <i className="gh-counter">3</i>
          </span>
          <span className="gh-tab">
            Checks <i className="gh-counter">4</i>
          </span>
          <span className="gh-tab">
            Files changed <i className="gh-counter">5</i>
          </span>
          <span className="gh-diffstat">
            <b className="gh-add">+18</b> <b className="gh-del">−6</b>
            <i className="gh-blocks">
              <s className="gh-b-add" />
              <s className="gh-b-add" />
              <s className="gh-b-add" />
              <s className="gh-b-del" />
              <s />
            </i>
          </span>
        </div>
        <div className="gh-layout">
          <div className="gh-discussion">
            <div className="gh-comment">
              <span className="gh-avatar">a</span>
              <div className="gh-box">
                <div className="gh-box-head">
                  <span>
                    <b>alice</b> commented 2 hours ago
                  </span>
                  <span className="gh-label-pill">Author</span>
                  <IconDots size={16} />
                </div>
                <div className="gh-box-body">
                  <p>Rounds the fee down to the nearest yoctoNEAR, and adds a test for a 1 yocto transfer.</p>
                </div>
              </div>
            </div>
            <div className="gh-item">
              <span className="gh-badge gh-badge-ok">
                <IconCheck size={14} stroke={3} />
              </span>
              <span className="gh-avatar gh-avatar-xs">b</span>
              <b>bob</b> approved these changes <span className="gh-muted">1 hour ago</span>
            </div>
            <div className="gh-mergebox">
              <span className="gh-mergeicon">
                <IconGitMerge size={20} stroke={2} />
              </span>
              <div className="gh-box">
                <div className="gh-mrow">
                  <span className="gh-dot gh-dot-ok">
                    <IconCheck size={14} stroke={3} />
                  </span>
                  <div>
                    <b>Changes approved</b>
                    <span>1 approving review by reviewers with write access.</span>
                  </div>
                </div>
                <div className="gh-mrow">
                  <span className="gh-dot gh-dot-ok">
                    <IconCheck size={14} stroke={3} />
                  </span>
                  <div>
                    <b>All checks have passed</b>
                    <span>3 successful checks: build, test, lint</span>
                  </div>
                </div>
                <div className="gh-mrow">
                  <span className="gh-dot gh-dot-wait" />
                  <div>
                    <b>speak-to-sign / maintainer-voice</b>
                    <span>Expected — Waiting for a spoken approval of 9c1e2fa</span>
                  </div>
                  <span className="gh-required">Required</span>
                </div>
                <div className="gh-mfoot">
                  <span className="gh-btn gh-btn-primary gh-btn-split">
                    Merge pull request <i />
                    <IconCaretDownFilled size={10} />
                  </span>
                  <span className="gh-muted">You can also merge this with the command line.</span>
                </div>
              </div>
            </div>
          </div>
          <aside className="gh-sidebar">
            <div>
              <h3>Reviewers</h3>
              <p>
                <span className="gh-avatar gh-avatar-xs">b</span> bob <IconCheck size={14} stroke={2.5} className="gh-ok" />
              </p>
            </div>
            <div>
              <h3>Assignees</h3>
              <p className="gh-muted">No one—assign yourself</p>
            </div>
            <div>
              <h3>Labels</h3>
              <p>
                <span className="gh-ghlabel gh-ghlabel-bug">bug</span> <span className="gh-ghlabel gh-ghlabel-fees">fees</span>
              </p>
            </div>
            <div>
              <h3>Required approval</h3>
              <p>Maintainer, by voice</p>
            </div>
          </aside>
        </div>
      </div>
      <div className="ss-overlay-card">
        <WalletVoiceCard say={say} compact />
      </div>
    </div>
  );
}

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
