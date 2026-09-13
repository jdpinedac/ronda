// Publishes the original prototype alongside the app, under /prototype/, with
// a banner making clear it is the old approach. It is the only part of Ronda
// that currently measures anything, so it is worth having on a phone — but
// nobody should mistake it for the finished tool.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const src = new URL('../example/ronda.html', import.meta.url);
const destDir = new URL('../public/prototype/', import.meta.url);
const dest = new URL('index.html', destDir);

const BANNER = `
<div style="background:#33261C;color:#F6EEDF;padding:12px 16px;font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <strong>Versión antigua.</strong> Distingue voces por tono y brillo, así que
  a veces parte a una persona en dos o junta a dos en una. Es el punto de
  partida que estamos reemplazando por un motor mucho más preciso.
  <a href="../" style="color:#E8C9A0">Ver el proyecto</a>
</div>
`;

let html = await readFile(src, 'utf8');
html = html.replace('<body>', `<body>${BANNER}`);
await mkdir(destDir, { recursive: true });
await writeFile(dest, html);
console.log('staged example/ronda.html -> public/prototype/index.html');
