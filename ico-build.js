// Build a multi-size ICO from PNG files (PNG-compressed entries, Vista+).
// Usage: node ico-build.js <out.ico> <png-256> <png-128> ... (order = any)
const fs = require('node:fs');

const out = process.argv[2];
const files = process.argv.slice(3).map((f) => {
  const buf = fs.readFileSync(f);
  const size = parseInt(f.match(/(\d+)\.png$/)[1], 10);
  return { size, buf };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(files.length, 4);

const entries = [];
let offset = 6 + files.length * 16;
for (const { size, buf } of files) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  e.writeUInt8(size >= 256 ? 0 : size, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(buf.length, 8); // size
  e.writeUInt32LE(offset, 12); // offset
  entries.push(e);
  offset += buf.length;
}

fs.writeFileSync(out, Buffer.concat([header, ...entries, ...files.map((f) => f.buf)]));
console.log('wrote', out, files.length, 'sizes:', files.map((f) => f.size).join(','), 'total', offset, 'bytes');
