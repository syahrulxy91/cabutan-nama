import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readNames } from '../dist/roster-import.mjs';

test('imports the Nama column from comma and semicolon CSV', async () => {
  for (const delimiter of [',', ';']) {
    const csv = ['Bil;Nama', '1;Aina Uji', '2;Badrul Uji'].join('\r\n').replaceAll(';', delimiter);
    const file = new File([csv], 'roster.csv');
    assert.deepEqual(await readNames(file), ['Aina Uji', 'Badrul Uji']);
  }
});

test('rejects invalid Word files with a suitable import message', async () => {
  await assert.rejects(readNames(new File(['invalid Word file'], 'roster.docx')), /Fail Word atau Excel tidak dapat dibaca/);
});

test('reads CSV files saved by Excel in the Windows-1252 code page', async () => {
  const bytes = Uint8Array.from([...'Nama\r\nJos', 0xe9, ...'\r\nAin\r\n'].flatMap(c => typeof c === 'number' ? [c] : [...c].map(ch => ch.charCodeAt(0))));
  assert.deepEqual(await readNames(new File([bytes], 'senarai.csv')), ['José', 'Ain']);
});
