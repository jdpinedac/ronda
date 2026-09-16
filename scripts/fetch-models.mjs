// Downloads the ONNX weights into public/models/ so they are served from our
// own origin. Not committed: the build fetches them, including in CI, and the
// Pages artifact carries them.
//
// Serving from our own origin matters under cross-origin isolation, and it
// means the app does not depend on a third party staying up. Every file is
// checked against the SHA-256 that Hugging Face records for it, so a bad or
// substituted download fails the build instead of shipping.
import { createHash } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const MODELS = [
  {
    name: 'segmentation-int8.onnx',
    url: 'https://huggingface.co/onnx-community/pyannote-segmentation-3.0/resolve/main/onnx/model_quantized.onnx',
    sha256: '93a3eb106923c9b76a7d8af07ac337dd24c2d0dcd20f1b6c55f21133e944d658',
    bytes: 1542308,
  },
  {
    name: 'embedding-int8.onnx',
    url: 'https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM/resolve/main/onnx/model_quantized.onnx',
    sha256: 'f73f647730ae440ae411c2241290f42ff5b2106dd3176c897fe6fbb1950d5393',
    bytes: 6685134,
  },
];

const dir = new URL('../public/models/', import.meta.url);
await mkdir(dir, { recursive: true });

const digest = (buf) => createHash('sha256').update(buf).digest('hex');

for (const m of MODELS) {
  const dest = new URL(m.name, dir);
  // Read rather than check-then-read: a file that vanishes in between is
  // simply fetched.
  const have = await readFile(dest).catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (have !== null) {
    if (digest(have) === m.sha256) {
      console.log(`ok    ${m.name} (cached)`);
      continue;
    }
    console.log(`stale ${m.name}, refetching`);
  }
  process.stdout.write(`fetch ${m.name} ... `);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = digest(buf);
  if (got !== m.sha256) {
    throw new Error(`${m.name}: checksum mismatch\n  expected ${m.sha256}\n  got      ${got}`);
  }
  if (buf.length !== m.bytes) throw new Error(`${m.name}: expected ${m.bytes} bytes, got ${buf.length}`);
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1048576).toFixed(2)} MB, checksum ok`);
}
