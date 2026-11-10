// Type checks of the public plugin API: `pnpm type-check` fails if one of them breaks. The
// Wallet's own `seams.speakToSign` property is checked in seams-wallet.

import {
  SeamsWeb,
  type SeamsConfigsInput,
  type WalletTransactionFeaturePlugin,
} from '@seams/wallet';
import type { SPEAK_TO_SIGN_HOST_API_VERSION } from '@seams/wallet/speak-to-sign-host';
import type { VOICE_ID_HOST_API_VERSION } from '@seams/wallet/voiceid-host';
import { speakToSign } from '../src/descriptor';
import * as host from '../src/host';

declare const base: SeamsConfigsInput;
const feature = speakToSign({ network: 'testnet' });
const asFeature: WalletTransactionFeaturePlugin = feature;
void asFeature;
void new SeamsWeb({ ...base, transactionFeatures: [feature] });

// @ts-expect-error The network is testnet or mainnet.
speakToSign({ network: 'betanet' });
// @ts-expect-error A spoken payment comes from the owner's own account; there is no vault.
speakToSign({ vault: 'vault.testnet', network: 'testnet' });

// The plugin speaks the host API of the Wallet that it is built against.
const hostVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION = host.hostApiVersion;
void hostVersion;
// @ts-expect-error Speak-to-Sign has its own host API version, separate from VoiceID's.
const sharedVersion: typeof VOICE_ID_HOST_API_VERSION = host.hostApiVersion;
void sharedVersion;
