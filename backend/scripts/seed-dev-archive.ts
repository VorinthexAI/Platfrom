import { db, closeDb } from '@/lib/db/client';
import { toArangoDoc } from '@/lib/db/base';
import { folderSchema, FOLDERS_COLLECTION } from '@/lib/db/folders.node';
import { documentSchema, DOCUMENTS_COLLECTION } from '@/lib/db/documents.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { hashUserEmail } from '@/api/users';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { htmlToDocx } from '@/lib/ai/document-processing/exports';

const EMAIL = 'oscar.burman005@gmail.com';
const KEYS = {
  projects: 'cmsq7m4uk0000zk7kf8213jjf',
  research: 'cmsq7m4uk0001zk7k1pq41dvd',
  personal: 'cmsq7m4uk0002zk7khtvf2cn8',
  launch: 'cmsq7m4uk0003zk7k8xky303b',
  references: 'cmsq7m4uk0004zk7k2xwa8y5e',
  journal: 'cmsq7m4uk0005zk7k74ow1rtx',
  welcome: 'cmsq7m4uk0006zk7kcyde7izf',
  roadmap: 'cmsq7m4ul0007zk7kbev12pfc',
  researchNote: 'cmsq7m4ul0008zk7k4qyzae0o',
  journalNote: 'cmsq7m4ul0009zk7k516c6k6p',
  pdf: 'cmsq7m4ul000azk7kgr9p19a3',
  pdfBrief: 'cmsrt115v00003g7kc2g08p7i',
  docBrief: 'cmsrt115v00013g7kcwv05jvq',
  docAgenda: 'cmsrt115v00023g7kca6vdq2t',
  docxReview: 'cmsrt115v00033g7kgk9hcm1b',
  docxPlan: 'cmsrt115v00043g7k1dil1cce',
  markdownRunbook: 'cmsrt115v00053g7k8cpe1urq',
  markdownDecisions: 'cmsrt115v00063g7kck57g4w6',
  textInterviews: 'cmsrt115v00073g7k406886ls',
  textIdeas: 'cmsrt115v00083g7kh2u2beac',
} as const;

function requireLocalEndpoint(name: string, value: string | undefined) {
  if (!value || !/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(value)) {
    throw new Error(`${name} must point to a local development service.`);
  }
}

function embedding() {
  return Array<number>(EMBEDDING_DIMENSIONS).fill(0);
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function minimalPdf(text: string) {
  const safeText = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${safeText}) Tj ET`;
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

async function upsert(collectionName: string, value: { key: string }) {
  await db.collection(collectionName).save(toArangoDoc(value), { overwriteMode: 'replace' });
}

async function main() {
  requireLocalEndpoint('ARANGO_URL', process.env.ARANGO_URL);
  requireLocalEndpoint('S3 endpoint', process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL);
  const user = await getUserByEmailHash(await hashUserEmail(EMAIL));
  if (!user) throw new Error(`Dev user ${EMAIL} does not exist. Sign in once before seeding.`);
  const context = await getPersonalAuthContext(user.key);
  if (!context) throw new Error(`Personal Archive context for ${EMAIL} is unavailable.`);
  const scopeKey = context.scope.key;
  const now = new Date().toISOString();
  const vector = embedding();

  const folders = [
    { key: KEYS.projects, name: 'Projects', description: 'Active plans, launches, and working material.' },
    { key: KEYS.research, name: 'Research', description: 'Reading notes and source material.' },
    { key: KEYS.personal, name: 'Personal', description: 'Private notes and everyday ideas.' },
    { key: KEYS.launch, parentFolderKey: KEYS.projects, name: '2026 Launch', description: 'Launch planning and execution.' },
    { key: KEYS.references, parentFolderKey: KEYS.research, name: 'References', description: 'Saved papers and reference files.' },
    { key: KEYS.journal, parentFolderKey: KEYS.personal, name: 'Journal', description: 'Daily reflections and observations.' },
  ];
  for (const folder of folders) {
    await upsert(FOLDERS_COLLECTION, folderSchema.parse({ ...folder, scopeKey, embedding: vector, deletedAt: null, createdAt: now, updatedAt: now }));
  }

  const pdfBytes = minimalPdf('Vorinthex Archive reference: calm systems for focused work.');
  const pdfStorageKey = `content/${scopeKey}/${KEYS.references}/${KEYS.pdf}/dev-seed/original.pdf`;
  await documentStorage.upload({ key: pdfStorageKey, bytes: pdfBytes, mimeType: 'application/pdf' });

  const imported = [
    { key: KEYS.pdfBrief, name: 'Product discovery brief', folderKey: KEYS.references, extension: 'pdf' as const, mimeType: 'application/pdf', content: 'Product discovery brief covering customer pain, desired outcomes, risks, and the next validation interviews.', html: '<h1>Product discovery brief</h1><p>Customer pain, desired outcomes, risks, and the next validation interviews.</p>', bytes: minimalPdf('Product discovery: customer pain, outcomes, risks, and next interviews.') },
    { key: KEYS.docBrief, name: 'Partner briefing - legacy Word', folderKey: KEYS.references, extension: 'doc' as const, mimeType: 'application/msword', content: 'Partner briefing with launch context, responsibilities, dependencies, and open commercial questions.', html: '<h1>Partner briefing</h1><p>Launch context, responsibilities, dependencies, and open commercial questions.</p>' },
    { key: KEYS.docAgenda, name: 'Workshop agenda - legacy Word', folderKey: KEYS.projects, extension: 'doc' as const, mimeType: 'application/msword', content: 'Workshop agenda: align on the problem, map assumptions, rank experiments, assign owners, and agree on follow-up dates.', html: '<h1>Workshop agenda</h1><p>Align on the problem, map assumptions, rank experiments, assign owners, and agree on follow-up dates.</p>' },
    { key: KEYS.docxReview, name: 'Quarterly operating review', folderKey: KEYS.launch, extension: 'docx' as const, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: 'Quarterly operating review covering activation, retention, reliability, customer evidence, and priorities for the next quarter.', html: '<h1>Quarterly operating review</h1><ul><li>Activation and retention</li><li>Reliability</li><li>Customer evidence</li><li>Next-quarter priorities</li></ul>' },
    { key: KEYS.docxPlan, name: 'Launch communication plan', folderKey: KEYS.launch, extension: 'docx' as const, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: 'Launch communication plan for internal readiness, customer announcements, support preparation, and the release-day timeline.', html: '<h1>Launch communication plan</h1><p>Internal readiness, customer announcements, support preparation, and the release-day timeline.</p>' },
    { key: KEYS.markdownRunbook, name: 'Launch runbook', folderKey: KEYS.launch, extension: 'md' as const, mimeType: 'text/markdown', content: 'Launch runbook with readiness checks, deployment steps, smoke tests, communication tasks, and rollback ownership.', html: '<h1>Launch runbook</h1><ul><li>Confirm readiness</li><li>Deploy and smoke test</li><li>Send communication</li><li>Confirm rollback owner</li></ul>', source: '# Launch runbook\n\n- [ ] Confirm readiness\n- [ ] Deploy and smoke test\n- [ ] Send communication\n- [ ] Confirm rollback owner\n' },
    { key: KEYS.markdownDecisions, name: 'Architecture decisions', folderKey: KEYS.research, extension: 'md' as const, mimeType: 'text/markdown', content: 'Architecture decisions documenting private storage, signed URLs, canonical actions, cache convergence, and product-neutral tool names.', html: '<h1>Architecture decisions</h1><p>Private storage, signed URLs, canonical actions, cache convergence, and product-neutral tool names.</p>', source: '# Architecture decisions\n\n1. Keep originals private.\n2. Return short-lived signed URLs.\n3. Share canonical actions across tools and APIs.\n4. Use product-neutral tool names.\n' },
    { key: KEYS.textInterviews, name: 'Customer interview notes', folderKey: KEYS.research, extension: 'txt' as const, mimeType: 'text/plain', content: 'Customer interview notes\n\nPeople want faster retrieval, fewer duplicated decisions, and a clear next action after every research session.', html: '<pre><code>Customer interview notes\n\nPeople want faster retrieval, fewer duplicated decisions, and a clear next action after every research session.</code></pre>' },
    { key: KEYS.textIdeas, name: 'Idea inbox', folderKey: KEYS.personal, extension: 'txt' as const, mimeType: 'text/plain', content: 'Idea inbox\n\nCreate a weekly review ritual. Link decisions to evidence. Keep a short list of unanswered questions. Protect one quiet writing block.', html: '<pre><code>Idea inbox\n\nCreate a weekly review ritual. Link decisions to evidence. Keep a short list of unanswered questions. Protect one quiet writing block.</code></pre>' },
  ];
  const encoder = new TextEncoder();
  const importedDocuments = [];
  for (const document of imported) {
    const bytes = document.extension === 'pdf'
      ? document.bytes!
      : document.extension === 'docx'
        ? htmlToDocx(document.html)
        : encoder.encode(document.extension === 'md' ? document.source! : document.extension === 'doc' ? document.html : document.content);
    const storageKey = `content/${scopeKey}/${document.folderKey}/${document.key}/dev-seed/original.${document.extension}`;
    await documentStorage.upload({ key: storageKey, bytes, mimeType: document.mimeType });
    importedDocuments.push({ ...document, storageKey, sizeBytes: bytes.byteLength });
  }

  const documents = [
    { key: KEYS.welcome, name: 'Welcome to Archive', folderKey: undefined, content: 'Archive keeps notes, documents, research, and source files organized in one private workspace.' },
    { key: KEYS.roadmap, name: 'Launch roadmap', folderKey: KEYS.launch, content: 'Confirm positioning, finish onboarding, test authentication, prepare launch communication, and review activation metrics.' },
    { key: KEYS.researchNote, name: 'Research notes', folderKey: KEYS.research, content: 'Useful systems reduce friction, preserve context, and make the next action obvious.' },
    { key: KEYS.journalNote, name: 'Monday reflection', folderKey: KEYS.journal, content: 'The best work today came from protecting one quiet hour and writing the decision down before acting.' },
    { key: KEYS.pdf, name: 'Focused work reference', folderKey: KEYS.references, content: 'A short PDF reference about calm systems for focused work.', extension: 'pdf' as const, mimeType: 'application/pdf', storageKey: pdfStorageKey, sizeBytes: pdfBytes.byteLength },
    ...importedDocuments,
  ];
  for (const document of documents) {
    const contentChunks = [document.content];
    await upsert(DOCUMENTS_COLLECTION, documentSchema.parse({
      ...document,
      scopeKey,
      html: 'html' in document ? document.html : `<p>${escapeHtml(document.content)}</p>`,
      embedding: vector,
      contentChunks,
      chunkEmbeddings: [vector],
      semanticChunkCount: 1,
      semanticContentHash: documentSemanticHash(document.content),
      isFavorite: document.key === KEYS.researchNote,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
  }

  console.log(`Seeded ${folders.length} folders and ${documents.length} documents for ${EMAIL} in scope ${scopeKey}.`);
}

try {
  await main();
} finally {
  await closeDb();
}
