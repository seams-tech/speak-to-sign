import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeVoiceIdWalletAssets } from '@seams/voiceid/hosting';

const speakPublic = fileURLToPath(new URL('./public/', import.meta.url));
const ASSET_DIRECTORY = 'sdk/speak-to-sign';
const CACHE_POLICY = 'public, max-age=300, must-revalidate';
const CONTENT_TYPES = {
  '.js': ['javascript', 'text/javascript; charset=utf-8'],
  '.wasm': ['wasm', 'application/wasm'],
};

/**
 * Speak-to-Sign needs VoiceID, so this composes Wallet and VoiceID first and then adds
 * the Speak-to-Sign assets. No source asset tree changes.
 */
export async function composeSpeakToSignWalletAssets({ walletPublicDirectory, outputDirectory }) {
  const output = path.resolve(outputDirectory);
  if (contains(speakPublic, output) || contains(output, speakPublic)) {
    throw new Error('Compose Speak-to-Sign into a separate deployment directory.');
  }
  await composeVoiceIdWalletAssets({ walletPublicDirectory, outputDirectory: output });
  await cp(path.join(speakPublic, ASSET_DIRECTORY), path.join(output, ASSET_DIRECTORY), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const manifestPath = path.join(output, 'wallet-assets.manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const filename of await readdir(path.join(speakPublic, ASSET_DIRECTORY))) {
    manifest.assets.push(speakToSignAsset(filename));
  }
  manifest.assets.sort(bySourceFile);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return output;
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function bySourceFile(left, right) {
  return left.sourceFile.localeCompare(right.sourceFile);
}

function speakToSignAsset(filename) {
  const sourceFile = `${ASSET_DIRECTORY}/${filename}`;
  const [routeClass, contentType] = CONTENT_TYPES[path.extname(filename)] ?? [
    'binary',
    'application/octet-stream',
  ];
  return {
    route: `/${sourceFile}`,
    sourceFile,
    owner: 'wallet_sdk_asset',
    routeClass,
    contentType,
    cachePolicy: CACHE_POLICY,
    requiredHeaders: [
      { name: 'Content-Type', value: contentType },
      { name: 'Cache-Control', value: CACHE_POLICY },
      { name: 'Access-Control-Allow-Origin', value: '*' },
    ],
  };
}
