// "Your bets" in the right column: each market where the signed-in account has a stake, quiet as
// X's own side boxes. A row names the market's question and its state, links to the post's card
// in the timeline, and shows the position as tinted pills (as the strip does). Under it, the
// newest bets of that market link to their transactions on the explorer.

import { IconExternalLink } from '@tabler/icons-react';
import { TxLink } from '../components/bits';
import { accountUrl } from '../config';
import { findPost } from '../data/posts';
import { useDemo } from '../demoContext';
import { useMarketSource } from '../market/contractSource';
import { amountText, timeLeftText } from '../market/math';
import { useMyBets, type MyMarket } from '../market/myBets';
import { NEAR_CURRENCY, type Currency, type NoteMarket } from '../market/types';
import type { Note } from '../notes/types';
import { MY_BETS_TITLE_ID, postCardId, showCard } from './Timeline';

/** The bets with a transaction link under each market. An account explorer link has the rest. */
const MAX_TX_ROWS = 3;

export function MyBets() {
  const { account, notesByPost } = useDemo();
  const source = useMarketSource();
  const markets = useMyBets(account, source);
  if (!account || markets.length === 0) return null;
  const currency = source.currency ?? NEAR_CURRENCY;
  return (
    <section className="side-box" aria-labelledby={MY_BETS_TITLE_ID}>
      <h2 id={MY_BETS_TITLE_ID} className="side-title">
        Your bets
      </h2>
      <ul className="trend-list">
        {markets.map((entry) => (
          <MarketRow key={entry.market.id} entry={entry} postId={postOf(entry.market, notesByPost)} currency={currency} account={account} />
        ))}
      </ul>
    </section>
  );
}

function MarketRow({ entry, postId, currency, account }: { entry: MyMarket; postId: number | null; currency: Currency; account: string }) {
  const { market, position, bets } = entry;
  const sides = (['yes', 'no'] as const).filter((side) => position[side] > 0n);
  const author = postId === null ? null : findPost(postId)?.author.name;
  const body = (
    <>
      <span className="trend-kicker my-bet-state" data-status={market.status}>
        {stateText(market)}
      </span>
      <span className="trend-title">{market.question}</span>
      {author && <span className="trend-meta muted">On the post of {author}</span>}
      <span className="nm-pills my-bet-pills">
        {sides.map((side) => (
          <span key={side} className={`nm-pill nm-pill-${side}`}>
            {amountText(position[side], currency)} {side}
          </span>
        ))}
      </span>
    </>
  );
  return (
    <li className="trend-item">
      {/* The post has no page: its card in the timeline comes into view and flashes. */}
      {postId === null ? (
        <div className="trend">{body}</div>
      ) : (
        <a
          className="trend"
          href={`#${postCardId(postId)}`}
          onClick={(event) => {
            event.preventDefault();
            showCard(postId);
          }}
        >
          {body}
        </a>
      )}
      {/* Outside the row's link: a link cannot hold another link. */}
      {bets.length > 0 && (
        <ul className="trend-tx my-bet-txs">
          {bets.slice(0, MAX_TX_ROWS).map((bet) => (
            <li key={`${bet.hash}-${bet.side}-${bet.amount}`}>
              <span className="my-bet-tx-amount" data-side={bet.side}>
                {amountText(bet.amount, currency)} {bet.side}
              </span>
              <TxLink hash={bet.hash} />
            </li>
          ))}
          {bets.length > MAX_TX_ROWS && (
            <li>
              <a className="lk tx-link" href={accountUrl(account)} target="_blank" rel="noopener noreferrer">
                {bets.length - MAX_TX_ROWS} more on the explorer
                <IconExternalLink size={13} stroke={1.8} aria-hidden="true" />
              </a>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** The market's state in a few words, such as "Open · 6 d left" or "Decided by JEV". */
function stateText(market: NoteMarket): string {
  switch (market.status) {
    case 'open':
      return `Open · ${timeLeftText(market.closesAtMs)}`;
    case 'closed':
      return 'Betting closed';
    case 'resolving':
      return 'JEV is deciding';
    case 'resolved':
      return 'Decided by JEV';
  }
}

/** The post that a market is about: the note's post. Null when the page does not know the note. */
function postOf(market: NoteMarket, notesByPost: Record<number, Note[]>): number | null {
  for (const notes of Object.values(notesByPost)) {
    const note = notes.find((item) => item.id === market.noteId);
    if (note) return note.post_id;
  }
  return null;
}
