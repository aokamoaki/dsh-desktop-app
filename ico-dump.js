// Dump ICO entries and extract embedded images.
const fs = require('node:fs');
const path = require('node:path');

function parseIco(file) {
  const buf = fs.readFileSync(file);
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf.readUInt8(o) || 256;
    const h = buf.readUInt8(o + 1) || 256;
    const bpp = buf.readUInt16LE(o + 6);
    const size = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    const data = buf.subarray(off, off + size);
    // PNG entries start with \x89PNG
    const isPng = data[0] === 0x89 && data[1] === 0x50;
    out.push({ w, h, bpp, size, isPng });
    if (isPng) {
      const f = file.replace(/\.ico$/i, '') + `-${w}x${h}.png`;
      fs.writeFileSync(f, data);
    }
  }
  return out;
}

for (const f of process.argv.slice(2)) {
  console.log('== ' + f);
  try { console.log(JSON.stringify(parseIco(f))); }
  catch (e) { console.log('parse failed: ' + e.message); }
}
