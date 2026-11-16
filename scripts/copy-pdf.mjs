import { mkdir, copyFile, cp } from 'node:fs/promises';

const source = 'node_modules/pdfjs-dist';
const destination = 'dist/pdfjs-build';
await mkdir(destination, { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  await copyFile(source + '/build/' + file, destination + '/' + file);
}
await copyFile(source + '/LICENSE', destination + '/LICENSE');
await cp(source + '/cmaps', destination + '/cmaps', { recursive: true });
await cp(source + '/standard_fonts', destination + '/standard_fonts', { recursive: true });
