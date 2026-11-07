// Gate 0 item 1: compare tract outputs with ONNX Runtime Web (the engine the
// Wallet uses today) on the same input.
//
// Usage: node compare-ort.mjs <ort-web-dir> <assets-dir> <dump-dir> <model>...
// The dump dir holds <model>-input.f32 and <model>-tract-output.f32 from
// `PROBE_DUMP_DIR=<dump-dir> gate0-model-probe <model> ... run`.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [ortDir, assetsDir, dumpDir, ...models] = process.argv.slice(2);
const ort = await import(pathToFileURL(path.join(ortDir, 'dist/ort.node.min.mjs')).href);
ort.env.wasm.numThreads = 1;

const files = {
  redimnet: ['redimnet-b1.onnx', 'embedding'],
  aurora: ['aurora-int8.onnx', 'logits'],
  citrinet: ['citrinet-int8.onnx', 'logits'],
};

async function f32(file) {
  const bytes = await readFile(file);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function argmaxRows(values, width) {
  const rows = [];
  for (let start = 0; start < values.length; start += width) {
    let best = 0;
    for (let index = 1; index < width; index += 1) {
      if (values[start + index] > values[start + best]) best = index;
    }
    rows.push(best);
  }
  return rows;
}

for (const model of models) {
  const [file, outputName] = files[model];
  const input = await f32(path.join(dumpDir, `${model}-input.f32`));
  const tract = await f32(path.join(dumpDir, `${model}-tract-output.f32`));
  const session = await ort.InferenceSession.create(path.join(assetsDir, file), {
    executionProviders: ['wasm'],
  });
  const started = performance.now();
  const outputs = await session.run({ samples: new ort.Tensor('float32', input, [1, input.length]) });
  const elapsedMs = performance.now() - started;
  const reference = outputs[outputName].data;
  const dims = outputs[outputName].dims;
  let maxAbs = 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < reference.length; index += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(reference[index] - tract[index]));
    dot += reference[index] * tract[index];
    normA += reference[index] ** 2;
    normB += tract[index] ** 2;
  }
  const result = {
    model,
    dims,
    lengthsMatch: reference.length === tract.length,
    maxAbsDiff: maxAbs,
    cosine: dot / Math.sqrt(normA * normB),
    ortRunMs: Math.round(elapsedMs),
  };
  if (dims.length === 3) {
    const width = dims[2];
    const a = argmaxRows(reference, width);
    const b = argmaxRows(tract, width);
    result.frameArgmaxAgreement = a.filter((value, index) => value === b[index]).length / a.length;
  }
  console.log(JSON.stringify(result));
}
