// Turn dist/index.html into dist/artifact.html: the artifact host supplies the document skeleton,
// so emit only the title, metadata, font/style links, root node and module script.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const out = [
  ...pick(/<title>.*?<\/title>/g),
  ...pick(/<meta name="description"[^>]*>/g),
  ...pick(/<link [^>]*>/g),
  '<div id="root"></div>',
  ...pick(/<script [^>]*><\/script>/g),
].join('\n');
writeFileSync('dist/artifact.html', out + '\n');
console.log(out);
