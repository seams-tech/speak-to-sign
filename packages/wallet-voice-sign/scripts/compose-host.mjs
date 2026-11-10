#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { composeSpeakToSignWalletAssets } from './hosting.mjs';

const [outputDirectory, ...extra] = process.argv.slice(2);
if (!outputDirectory || extra.length) {
  throw new Error('Usage: seams-speak-to-sign-host <new-output-directory>');
}
const walletPackageUrl = import.meta.resolve('@seams/wallet/package.json');
const walletPublicDirectory = fileURLToPath(new URL('./dist/public/', walletPackageUrl));
console.log(await composeSpeakToSignWalletAssets({ walletPublicDirectory, outputDirectory }));
