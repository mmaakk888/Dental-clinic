import fs from 'node:fs';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';

export function listFiles(root: string): string[] {
  return fs.readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
    if (item.isSymbolicLink()) throw Error('Refusing symlink in release: ' + item.name);
    const file = path.join(root, item.name);
    return item.isDirectory() ? listFiles(file) : item.isFile() ? [file] : [];
  });
}
const crcTable = Uint32Array.from({length: 256}, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Standard UTF-8 ZIP32, no shell/Node packages needed on the host. */
export function createZip(output: string, root: string, files: string[]): void {
  if (fs.existsSync(output)) throw Error('Archive already exists: ' + output);
  if (files.length > 65535) throw Error('ZIP32 entry limit exceeded.');
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw Error('Unsafe archive path.');
    const name = Buffer.from(relative, 'utf8'), bytes = fs.readFileSync(file), packed = deflateRawSync(bytes, {level: 9}), crc = crc32(bytes);
    if (bytes.length > 0xffffffff || offset + packed.length > 0xffffffff || name.length > 65535) throw Error('ZIP32 size limit exceeded.');
    const date = fs.statSync(file).mtime;
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(time, 10); header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(8, 10); entry.writeUInt16LE(time, 12); entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(output, Buffer.concat([...local, directory, end]), {flag: 'wx'});
}
