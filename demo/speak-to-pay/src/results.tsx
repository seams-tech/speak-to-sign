import React from 'react';
import type {
  SpeakToSignEnrollmentResult,
  SpeakToSignRefusalReason,
  SpeakToSignResult,
  SpeakToSignSentTransaction,
} from '@seams/wallet';
import { RECEIPT_BASE_URL } from './chain';
import { Fact, Notice, ReasonNotice } from './components';
import {
  STAGE_LABELS,
  enrollmentRefusalText,
  formatSeconds,
  transferRefusalText,
  unavailableText,
} from './text';

/** The result of `seams.near.spoken.transfer`. */
export type SpokenTransferResult = SpeakToSignResult<
  SpeakToSignSentTransaction,
  SpeakToSignRefusalReason
>;

export function EnrollmentResult({
  result,
}: {
  result: SpeakToSignEnrollmentResult;
}): React.JSX.Element {
  switch (result.kind) {
    case 'enrolled':
      return (
        <Notice tone="success">
          The verifier stored your voice template. Template epoch {result.templateEpoch}, agreement{' '}
          {(result.agreementMilli / 1000).toFixed(3)}.
        </Notice>
      );
    case 'refused':
      return <ReasonNotice result={result} text={enrollmentRefusalText(result.reason)} />;
    case 'cancelled':
      return <Notice tone="info">You closed a Wallet window. Nothing was enrolled.</Notice>;
    case 'unavailable':
      return <ReasonNotice result={result} text={unavailableText(result.reason)} />;
  }
}

export function TransferResult({
  result,
}: {
  result: SpokenTransferResult;
}): React.JSX.Element {
  switch (result.kind) {
    case 'approved':
      return (
        <Notice tone="success">
          <p>
            {result.approval === 'voice'
              ? 'Paid from your account by voice, with no confirm.'
              : 'Paid from your account after your voice and your confirm.'}{' '}
            <ReceiptLink hash={result.result.transactionHash} />
          </p>
          <dl className="svi-facts svi-facts--times">
            {STAGE_LABELS.map(([key, label]) => (
              <Fact key={key} label={label}>
                {formatSeconds(result.times[key])}
              </Fact>
            ))}
          </dl>
        </Notice>
      );
    case 'refused':
      return (
        <ReasonNotice
          result={result}
          text={transferRefusalText(result.reason)}
          after="Nothing was sent."
        />
      );
    case 'cancelled':
      return <Notice tone="info">You closed the VoiceID window. Nothing was sent.</Notice>;
    case 'unavailable':
      return <ReasonNotice result={result} text={unavailableText(result.reason)} />;
  }
}

function ReceiptLink({ hash }: { hash: string }): React.JSX.Element {
  return (
    <a href={`${RECEIPT_BASE_URL}${hash}`} target="_blank" rel="noopener noreferrer">
      View the transaction on NearBlocks
    </a>
  );
}
