import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { openOfficeArchive } from '../dist/office.mjs';

test('Office archive reads stored and compressed XML and rejects truncated input', async () => {
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from('<document/>');
  // Only the archive reader is under test. Browsers supply the XML parser.
  const original = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(source) {
      return { source, querySelector: () => null };
    }
  };
  try {
    for (const method of [0, 8]) {
      const payload = method === 8 ? deflateRawSync(xml) : xml;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50);
      central.writeUInt16LE(method, 10);
      central.writeUInt32LE(payload.length, 20);
      central.writeUInt32LE(xml.length, 24);
      central.writeUInt16LE(name.length, 28);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50);
      end.writeUInt16LE(1, 10);
      end.writeUInt32LE(central.length + name.length, 12);
      end.writeUInt32LE(local.length + name.length + payload.length, 16);
      const read = await openOfficeArchive(new Blob([local, name, payload, central, name, end]));
      assert.equal((await read(name.toString())).source, xml.toString());
      await assert.rejects(openOfficeArchive(new Blob([local, name, payload])), /tidak dapat dibaca/);
    }
  } finally {
    if (original === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = original;
  }
});
