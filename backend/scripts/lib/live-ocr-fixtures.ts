import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

export interface LiveOcrFixture {
  name: string;
  kind: 'pdf' | 'image';
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  pages: number;
  build(): Promise<Buffer>;
}

function assemblePdf(objects: Buffer[]) {
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  let length = parts[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    parts.push(part);
    length += part.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

function streamObject(bytes: Buffer, fields = '') {
  return Buffer.concat([Buffer.from(`<< ${fields} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
}

export function createTextPdf(pages: number) {
  assert(Number.isInteger(pages) && pages >= 1 && pages <= 20);
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages} >>`), Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
  for (let page = 1; page <= pages; page += 1) {
    const contentId = objects.length + 2;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`));
    const lines = [`Silver observatory page ${page}`, ...Array.from({ length: 28 }, (_, index) => `Record ${index + 1}: Document processing and retrieval verification.`)];
    const commands = `BT /F1 12 Tf 18 TL 50 742 Td ${lines.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
    objects.push(streamObject(Buffer.from(commands)));
  }
  return assemblePdf(objects);
}

function pageSvg(width: number, height: number, page = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 600 800"><rect width="600" height="800" fill="white"/><g font-family="Arial" fill="black"><text x="32" y="65" font-size="28">Silver observatory page ${page}</text>${Array.from({ length: 14 }, (_, index) => `<text x="32" y="${115 + index * 38}" font-size="18">Record ${index + 1}: Processing verification.</text>`).join('')}</g></svg>`;
}

export async function createRasterPdf(pages: number) {
  assert(Number.isInteger(pages) && pages >= 1 && pages <= 18);
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${3 + index * 3} 0 R`).join(' ')}] /Count ${pages} >>`)];
  for (let page = 1; page <= pages; page += 1) {
    const { data, info } = await sharp(Buffer.from(pageSvg(600, 800, page))).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 3);
    // Actual raster data, not arbitrary padding: 18 pages approach the 25 MiB
    // upload limit. Level-zero Flate retains size while producing valid PDFs.
    const image = deflateSync(data, { level: 0 });
    const pageId = objects.length + 1;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`));
    objects.push(streamObject(Buffer.from('q 600 0 0 800 0 0 cm /Im0 Do Q')));
    objects.push(streamObject(image, `/Type /XObject /Subtype /Image /Width 600 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`));
  }
  return assemblePdf(objects);
}

export function liveOcrFixtures(): LiveOcrFixture[] {
  return [
    ...[1, 5, 20].map((pages): LiveOcrFixture => ({ name: `pdf-text-${pages}page`, kind: 'pdf', mimeType: 'application/pdf', pages, build: async () => createTextPdf(pages) })),
    ...[1, 5, 18].map((pages): LiveOcrFixture => ({ name: `pdf-raster-${pages}page`, kind: 'pdf', mimeType: 'application/pdf', pages, build: () => createRasterPdf(pages) })),
    ...([['png', 600, 800], ['png', 1800, 1000], ['jpeg', 1800, 2400]] as const).map(([format, width, height]): LiveOcrFixture => ({
      name: `${format}-${width}x${height}`, kind: 'image', mimeType: format === 'png' ? 'image/png' : 'image/jpeg', pages: 1,
      build: async () => {
        const image = sharp(Buffer.from(pageSvg(width, height))).removeAlpha();
        return (format === 'png' ? image.png({ compressionLevel: 0 }) : image.jpeg({ quality: 95 })).toBuffer();
      },
    })),
  ];
}
