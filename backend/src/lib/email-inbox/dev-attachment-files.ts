import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

export function mailDevAttachmentSafeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'attachment';
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function solidPng(red: number, green: number, blue: number, size = 32) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Array.from({ length: size }, () => {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      row[1 + x * 3] = red;
      row[2 + x * 3] = green;
      row[3 + x * 3] = blue;
    }
    return row;
  });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function minimalPdf(text: string) {
  const lines = text.match(/.{1,82}(?:\s+|$)/g)?.map((line) => line.trim()).filter(Boolean) ?? [text];
  const stream = `BT /F1 10 Tf 52 740 Td 0 -14 Td ${lines.slice(0, 48).map((line) => `(${line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export const MAIL_DEV_ATTACHMENT_IMAGE_SIZE = 32;

export function mailDevAttachmentFile(kind: 'document' | 'image', filename: string) {
  const seed = createHash('sha256').update(filename).digest();
  const bytes = kind === 'image'
    ? solidPng(seed[0]!, seed[1]!, seed[2]!)
    : minimalPdf(`Vorinthex local mail fixture attachment: ${filename}`);
  return {
    filename,
    mimeType: kind === 'image' ? 'image/png' : 'application/pdf',
    bytes,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
    width: kind === 'image' ? MAIL_DEV_ATTACHMENT_IMAGE_SIZE : undefined,
    height: kind === 'image' ? MAIL_DEV_ATTACHMENT_IMAGE_SIZE : undefined,
  };
}
