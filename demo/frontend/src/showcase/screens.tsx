// Drawn screens for the concept examples. They use neutral names and colours, not the
// logos of a real code host or multisig wallet. Each fills a 1100 × 688 screen that scales down.

import {
  IconAddressBook,
  IconApps,
  IconCheck,
  IconCircleFilled,
  IconCode,
  IconCoins,
  IconGitMerge,
  IconGitPullRequest,
  IconHome,
  IconListDetails,
  IconSend,
  IconSettings,
} from '@tabler/icons-react';
import { VoiceOverlay } from './frame';

export function MergeScreen({ say }: { say: string }) {
  return (
    <div className="gh">
      <div className="gh-top">
        <IconCode size={22} stroke={1.8} />
        <span>
          seams-tech / <b>speak-to-sign</b>
        </span>
        <span className="gh-me">M</span>
      </div>
      <nav className="gh-repo-tabs">
        <span>Code</span>
        <span>Issues 3</span>
        <span className="gh-on">Pull requests 1</span>
        <span>Actions</span>
        <span>Settings</span>
      </nav>
      <div className="gh-body">
        <h1 className="gh-title">
          Fix fee rounding in transfer <span className="gh-num">#412</span>
        </h1>
        <div className="gh-state">
          <span className="gh-open">
            <IconGitPullRequest size={16} stroke={2} /> Open
          </span>
          <span>
            <b>alice</b> wants to merge 3 commits into <code>main</code> from <code>fix/fee-rounding</code>
          </span>
        </div>
        <div className="gh-tabs">
          <span className="gh-on">Conversation 4</span>
          <span>Commits 3</span>
          <span>Checks 3</span>
          <span>Files changed 5</span>
          <span className="gh-diff">
            <b className="gh-add">+18</b> <b className="gh-del">−6</b>
          </span>
        </div>
        <div className="gh-grid">
          <div className="gh-main">
            <div className="gh-comment">
              <span className="gh-avatar">A</span>
              <div className="gh-bubble">
                <div className="gh-bubble-head">
                  <b>alice</b> commented 2 hours ago
                </div>
                <p>Rounds the fee down to the nearest yoctoNEAR, and adds a test for a 1 yocto transfer.</p>
              </div>
            </div>
            <div className="gh-event">
              <span className="gh-ok-dot">
                <IconCheck size={14} stroke={3} />
              </span>
              <b>bob</b> approved these changes
            </div>
            <div className="gh-merge">
              <div className="gh-row">
                <span className="gh-ok-dot">
                  <IconCheck size={14} stroke={3} />
                </span>
                <div>
                  <b>Changes approved</b>
                  <span>1 approving review by a maintainer</span>
                </div>
              </div>
              <div className="gh-row">
                <span className="gh-ok-dot">
                  <IconCheck size={14} stroke={3} />
                </span>
                <div>
                  <b>All checks have passed</b>
                  <span>build · test · lint</span>
                </div>
              </div>
              <div className="gh-row">
                <span className="gh-wait-dot">
                  <IconCircleFilled size={10} />
                </span>
                <div>
                  <b>speak-to-sign / maintainer voice</b>
                  <span>Required. Waiting for a spoken approval of commit 9c1e2fa.</span>
                </div>
              </div>
              <div className="gh-merge-foot">
                <span className="gh-btn">
                  <IconGitMerge size={16} stroke={2} /> Merge with voice
                </span>
                <span className="gh-hint">The merge runs after the Wallet signs the approval.</span>
              </div>
            </div>
          </div>
          <aside className="gh-side">
            <div>
              <h3>Reviewers</h3>
              <p>
                bob <IconCheck size={14} stroke={2.5} className="gh-ok" />
              </p>
            </div>
            <div>
              <h3>Required approval</h3>
              <p>Maintainer, by voice</p>
            </div>
            <div>
              <h3>Labels</h3>
              <p>
                <span className="gh-label gh-label-bug">bug</span> <span className="gh-label">fees</span>
              </p>
            </div>
          </aside>
        </div>
      </div>
      <VoiceOverlay say={say} />
    </div>
  );
}

export function MultisigScreen({ say }: { say: string }) {
  return (
    <div className="ms">
      <aside className="ms-side">
        <div className="ms-acct">
          <span className="ms-blockie" />
          <div>
            <b>Grants Treasury</b>
            <span>0x5aF3…9b21</span>
          </div>
          <span className="ms-thr">2/3</span>
        </div>
        <div className="ms-bal">
          <span>Total value</span>
          <b>$1,204,880</b>
        </div>
        <nav className="ms-nav">
          <span>
            <IconHome size={20} stroke={1.8} /> Home
          </span>
          <span>
            <IconCoins size={20} stroke={1.8} /> Assets
          </span>
          <span className="ms-on">
            <IconListDetails size={20} stroke={1.8} /> Transactions
          </span>
          <span>
            <IconAddressBook size={20} stroke={1.8} /> Address book
          </span>
          <span>
            <IconApps size={20} stroke={1.8} /> Apps
          </span>
          <span>
            <IconSettings size={20} stroke={1.8} /> Settings
          </span>
        </nav>
      </aside>
      <main className="ms-main">
        <h1>Transactions</h1>
        <div className="ms-tabs">
          <span className="ms-on">
            Queue <i>1</i>
          </span>
          <span>History</span>
        </div>
        <div className="ms-tx">
          <div className="ms-tx-head">
            <span className="ms-nonce">7</span>
            <span className="ms-kind">
              <IconSend size={18} stroke={1.8} /> Send
            </span>
            <b className="ms-amount">−25,000 USDC</b>
            <span className="ms-time">2 hours ago</span>
            <span className="ms-chip">1 out of 2</span>
          </div>
          <div className="ms-tx-body">
            <div className="ms-detail">
              <p>
                Send <b>25,000 USDC</b> to:
              </p>
              <div className="ms-addr">
                <span className="ms-blockie ms-blockie-2" />
                <div>
                  <b>grants.eth</b>
                  <span>0x8B1d…C3e0</span>
                </div>
              </div>
              <dl>
                <dt>Nonce</dt>
                <dd>7</dd>
                <dt>Transaction hash</dt>
                <dd>0x4f2a…91bd</dd>
              </dl>
            </div>
            <div className="ms-confirm">
              <p className="ms-step ms-step-done">
                <IconCheck size={16} stroke={3} /> Created
              </p>
              <p className="ms-step ms-step-done">
                <IconCheck size={16} stroke={3} /> Confirmations (1 of 2)
              </p>
              <p className="ms-owner">
                <IconCheck size={14} stroke={3} /> alice.eth
              </p>
              <p className="ms-owner ms-owner-wait">bob.eth (you)</p>
              <p className="ms-step">Can be executed</p>
              <div className="ms-btns">
                <span className="ms-btn">Confirm with voice</span>
                <span className="ms-btn ms-btn-ghost">Reject</span>
              </div>
            </div>
          </div>
        </div>
      </main>
      <VoiceOverlay say={say} />
    </div>
  );
}
