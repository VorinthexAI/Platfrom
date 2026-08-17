import { db, closeDb } from '@/lib/db/client';
import { buildEmbeddingText, toArangoDoc } from '@/lib/db/base';
import { folderSchema, FOLDERS_COLLECTION, foldersEmbeddingFields } from '@/lib/db/folders.node';
import { documentSchema, DOCUMENTS_COLLECTION } from '@/lib/db/documents.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { hashUserEmail } from '@/api/users';
import { embedTexts } from '@/lib/embeddings';
import { chunkDocumentContent, documentEmbeddingTexts, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { documentStorage } from '@/lib/ai/document-processing/storage';

const EMAIL = 'oscar.burman005@gmail.com';
const KEYS = {
  projects: 'cmsq7m4uk0000zk7kf8213jjf',
  research: 'cmsq7m4uk0001zk7k1pq41dvd',
  personal: 'cmsq7m4uk0002zk7khtvf2cn8',
  launch: 'cmsq7m4uk0003zk7k8xky303b',
  references: 'cmsq7m4uk0004zk7k2xwa8y5e',
  journal: 'cmsq7m4uk0005zk7k74ow1rtx',
  launchOperations: 'cmtd1r8ya0000zk7k2vpc4m1a',
  launchStrategy: 'cmtd1r8ya0001zk7k7kh9wq4e',
  interviews: 'cmtd1r8ya0002zk7k9s4bn5hx',
  synthesis: 'cmtd1r8ya0003zk7k3mp8df2q',
  goals: 'cmtd1r8ya0004zk7k6tw1cj9r',
  reading: 'cmtd1r8ya0005zk7k4yv7ng3s',
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
  longPdfStrategy: 'cmsrtkoe40000os7khvz2ae38',
  longPdfResearch: 'cmsrtkoe40001os7k0pywd4yc',
  longPdfOperations: 'cmsrtkoe40002os7k4sq32dv1',
  longDocNarrative: 'cmsrtkoe40003os7k1r4c0biv',
  longDocWorkshop: 'cmsrtkoe40004os7kbwao5go4',
  longDocRetrospective: 'cmsrtkoe40005os7k5ylya4zv',
  longDocxPlan: 'cmsrtkoe40006os7k8jqta729',
  longDocxReview: 'cmsrtkoe40007os7k4zzidslt',
  longDocxHandbook: 'cmsrtkoe40008os7k89zz3n8z',
  longMarkdownGuide: 'cmsrtkoe40009os7k0jl4gjfl',
  longMarkdownArchitecture: 'cmsrtkoe4000aos7kebwzhzwx',
  longMarkdownResearch: 'cmsrtkoe4000bos7k49hphiot',
  longTextTranscript: 'cmsrtkoe4000cos7ke5ita5ss',
  longTextJournal: 'cmsrtkoe4000dos7k9gr17azv',
  longTextBacklog: 'cmsrtkoe4000eos7k74iqglwl',
  readinessNote: 'cmtd1r8yb0006zk7k8fq2lv5c',
  positioningNote: 'cmtd1r8yb0007zk7k1hz6wr4n',
  interviewThemes: 'cmtd1r8yb0008zk7k5jc9pt3m',
  synthesisQuestions: 'cmtd1r8yb0009zk7k7rd4bv2x',
  quarterlyGoals: 'cmtd1r8yb000azk7k3ns8kf6w',
  readingQueue: 'cmtd1r8yb000bzk7k9gx2mq5d',
} as const;

function requireLocalEndpoint(name: string, value: string | undefined) {
  if (!value || !/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(value)) {
    throw new Error(`${name} must point to a local development service.`);
  }
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

function longContent(title: string, subject: string) {
  return [
    title,
    `Context\n\n${subject} matters because useful systems have to preserve enough context for a person to understand not only what was decided, but why the decision was made. This document captures the assumptions, constraints, evidence, and unresolved questions that shaped the current direction. It is intentionally detailed so search, summaries, downloads, and document navigation can be exercised with realistic material rather than one-line placeholders.`,
    `Current understanding\n\nThe strongest signal is that speed alone is not the goal. People want a dependable path from scattered information to a confident next action. That requires clear ownership, visible tradeoffs, and a record of what changed over time. The working approach is to keep source material close to the decision, distinguish facts from interpretations, and state uncertainty directly instead of hiding it behind polished language.`,
    `Plan\n\nFirst, collect representative examples and note where the current flow creates hesitation. Second, reduce unnecessary choices while preserving escape hatches for advanced work. Third, validate the result with concrete tasks rather than broad preference questions. Each milestone should have an owner, a measurable outcome, a review date, and a rollback condition. Progress should be summarized weekly so new contributors can enter without reconstructing the entire history.`,
    `Risks and mitigations\n\nThe main risks are stale context, premature automation, and interfaces that appear simple but conceal important state. Mitigate these by refreshing time-sensitive references, requiring confirmation before consequential mutations, and making loading, saving, failure, and completion states explicit. Keep private source files private, use short-lived access URLs, and ensure every automated action converges with the same cache and persistence paths used by direct user actions.`,
    `Open questions\n\nWhich signals best predict that the workflow is genuinely useful? Where should the system ask for clarification instead of guessing? How long should historical context remain prominent? What information must be visible on mobile when space is constrained? The next review should answer these questions with observed behavior, document the evidence, and update this plan without erasing the reasoning that came before.`,
  ].join('\n\n');
}

function longMarkdown(content: string) {
  return content.split(/\n\n/).map((block, index) => index % 2 === 0 ? `## ${block}` : block).join('\n\n');
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
  const folders = [
    { key: KEYS.projects, name: 'Projects', description: 'Active plans, launches, and working material.' },
    { key: KEYS.research, name: 'Research', description: 'Reading notes and source material.' },
    { key: KEYS.personal, name: 'Personal', description: 'Private notes and everyday ideas.' },
    { key: KEYS.launch, parentFolderKey: KEYS.projects, name: '2026 Launch', description: 'Launch planning and execution.' },
    { key: KEYS.references, parentFolderKey: KEYS.research, name: 'References', description: 'Saved papers and reference files.' },
    { key: KEYS.journal, parentFolderKey: KEYS.personal, name: 'Journal', description: 'Daily reflections and observations.' },
    { key: KEYS.launchOperations, parentFolderKey: KEYS.launch, name: 'Launch Operations', description: 'Release readiness, runbooks, incidents, and rollout coordination.' },
    { key: KEYS.launchStrategy, parentFolderKey: KEYS.launch, name: 'Positioning Strategy', description: 'Audience research, messaging, positioning, and launch narrative.' },
    { key: KEYS.interviews, parentFolderKey: KEYS.research, name: 'Customer Interviews', description: 'Interview transcripts, observations, and customer evidence.' },
    { key: KEYS.synthesis, parentFolderKey: KEYS.interviews, name: 'Evidence Synthesis', description: 'Recurring themes, contradictions, findings, and open research questions.' },
    { key: KEYS.goals, parentFolderKey: KEYS.personal, name: 'Quarterly Goals', description: 'Personal priorities, progress reviews, habits, and measurable outcomes.' },
    { key: KEYS.reading, parentFolderKey: KEYS.personal, name: 'Reading Queue', description: 'Books, essays, saved reading, and notes to revisit.' },
  ];
  const folderEmbeddings = await embedTexts({ texts: folders.map((folder) => buildEmbeddingText(foldersEmbeddingFields, folder)!) });
  for (const [index, folder] of folders.entries()) {
    await upsert(FOLDERS_COLLECTION, folderSchema.parse({ ...folder, scopeKey, embedding: folderEmbeddings[index], deletedAt: null, createdAt: now, updatedAt: now }));
  }

  const pdfBytes = minimalPdf('Vorinthex Archive reference: calm systems for focused work.');
  const pdfStorageKey = `content/${scopeKey}/${KEYS.references}/${KEYS.pdf}/dev-seed/original.pdf`;
  await documentStorage.upload({ key: pdfStorageKey, bytes: pdfBytes, mimeType: 'application/pdf' });

  const longDocuments = [
    [KEYS.longPdfStrategy, 'Product strategy narrative', KEYS.references, 'pdf', 'How Archive supports durable personal knowledge and deliberate action.'],
    [KEYS.longPdfResearch, 'Research synthesis report', KEYS.synthesis, 'pdf', 'A synthesis of interviews about retrieval, trust, organization, and collaboration.'],
    [KEYS.longPdfOperations, 'Operating model reference', KEYS.projects, 'pdf', 'An operating model for weekly planning, decision review, and cross-functional execution.'],
    [KEYS.longDocNarrative, 'Company narrative - legacy Word', KEYS.projects, 'doc', 'A detailed narrative connecting customer problems, product principles, and market direction.'],
    [KEYS.longDocWorkshop, 'Discovery workshop transcript - legacy Word', KEYS.interviews, 'doc', 'Notes and conclusions from a long-form product discovery workshop.'],
    [KEYS.longDocRetrospective, 'Launch retrospective - legacy Word', KEYS.launchOperations, 'doc', 'A retrospective covering preparation, release execution, incidents, and follow-up actions.'],
    [KEYS.longDocxPlan, 'Annual product plan', KEYS.projects, 'docx', 'A detailed annual plan with outcomes, sequencing, dependencies, and operating assumptions.'],
    [KEYS.longDocxReview, 'Customer evidence review', KEYS.research, 'docx', 'A review of customer evidence organized by repeated needs, objections, and behavior.'],
    [KEYS.longDocxHandbook, 'Team operating handbook', KEYS.references, 'docx', 'A practical handbook for decisions, meetings, documentation, and incident response.'],
    [KEYS.longMarkdownGuide, 'Release engineering guide', KEYS.launchOperations, 'md', 'A release guide covering readiness, deployment, smoke testing, communication, and rollback.'],
    [KEYS.longMarkdownArchitecture, 'Archive architecture notes', KEYS.references, 'md', 'Architecture notes for storage, signed access, canonical actions, and cache convergence.'],
    [KEYS.longMarkdownResearch, 'Research repository guide', KEYS.synthesis, 'md', 'A guide for capturing observations, tagging evidence, and turning research into decisions.'],
    [KEYS.longTextTranscript, 'Extended customer transcript', KEYS.interviews, 'txt', 'An extended interview transcript about information overload, retrieval, and confidence.'],
    [KEYS.longTextJournal, 'Monthly reflection', KEYS.journal, 'txt', 'A long reflection on attention, decisions, habits, energy, and lessons from the month.'],
    [KEYS.longTextBacklog, 'Detailed idea backlog', KEYS.personal, 'txt', 'A detailed backlog of product, workflow, writing, and research ideas with next steps.'],
  ] as const;
  const imported = [
    { key: KEYS.pdfBrief, name: 'Product discovery brief', folderKey: KEYS.references, extension: 'pdf' as const, mimeType: 'application/pdf', content: 'Product discovery brief covering customer pain, desired outcomes, risks, and the next validation interviews.', bytes: minimalPdf('Product discovery: customer pain, outcomes, risks, and next interviews.') },
    { key: KEYS.docBrief, name: 'Partner briefing - legacy Word', folderKey: KEYS.references, extension: 'doc' as const, mimeType: 'application/msword', content: 'Partner briefing with launch context, responsibilities, dependencies, and open commercial questions.' },
    { key: KEYS.docAgenda, name: 'Workshop agenda - legacy Word', folderKey: KEYS.projects, extension: 'doc' as const, mimeType: 'application/msword', content: 'Workshop agenda: align on the problem, map assumptions, rank experiments, assign owners, and agree on follow-up dates.' },
    { key: KEYS.docxReview, name: 'Quarterly operating review', folderKey: KEYS.launchOperations, extension: 'docx' as const, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: 'Quarterly operating review covering activation, retention, reliability, customer evidence, and priorities for the next quarter.' },
    { key: KEYS.docxPlan, name: 'Launch communication plan', folderKey: KEYS.launchStrategy, extension: 'docx' as const, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: 'Launch communication plan for internal readiness, customer announcements, support preparation, and the release-day timeline.' },
    { key: KEYS.markdownRunbook, name: 'Launch runbook', folderKey: KEYS.launchOperations, extension: 'md' as const, mimeType: 'text/markdown', content: 'Launch runbook with readiness checks, deployment steps, smoke tests, communication tasks, and rollback ownership.', source: '# Launch runbook\n\n- [ ] Confirm readiness\n- [ ] Deploy and smoke test\n- [ ] Send communication\n- [ ] Confirm rollback owner\n' },
    { key: KEYS.markdownDecisions, name: 'Architecture decisions', folderKey: KEYS.research, extension: 'md' as const, mimeType: 'text/markdown', content: 'Architecture decisions documenting private storage, signed URLs, canonical actions, cache convergence, and product-neutral tool names.', source: '# Architecture decisions\n\n1. Keep originals private.\n2. Return short-lived signed URLs.\n3. Share canonical actions across tools and APIs.\n4. Use product-neutral tool names.\n' },
    { key: KEYS.textInterviews, name: 'Customer interview notes', folderKey: KEYS.interviews, extension: 'txt' as const, mimeType: 'text/plain', content: 'Customer interview notes\n\nPeople want faster retrieval, fewer duplicated decisions, and a clear next action after every research session.' },
    { key: KEYS.textIdeas, name: 'Idea inbox', folderKey: KEYS.personal, extension: 'txt' as const, mimeType: 'text/plain', content: 'Idea inbox\n\nCreate a weekly review ritual. Link decisions to evidence. Keep a short list of unanswered questions. Protect one quiet writing block.' },
    ...longDocuments.map(([key, name, folderKey, extension, subject]) => {
      const content = longContent(name, subject);
      return {
        key,
        name,
        folderKey,
        extension,
        mimeType: extension === 'pdf' ? 'application/pdf' : extension === 'doc' ? 'application/msword' : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : extension === 'md' ? 'text/markdown' : 'text/plain',
        content,
        ...(extension === 'pdf' ? { bytes: minimalPdf(content) } : {}),
        ...(extension === 'md' ? { source: longMarkdown(content) } : {}),
      };
    }),
  ];
  const encoder = new TextEncoder();
  const importedDocuments = [];
  for (const document of imported) {
    const bytes = document.extension === 'pdf'
      ? document.bytes!
      : encoder.encode(document.extension === 'md' ? document.source! : document.content);
    const storageKey = `content/${scopeKey}/${document.folderKey}/${document.key}/dev-seed/original.${document.extension}`;
    await documentStorage.upload({ key: storageKey, bytes, mimeType: document.mimeType });
    importedDocuments.push({ ...document, storageKey, sizeBytes: bytes.byteLength });
  }

  const documents = [
    { key: KEYS.welcome, name: 'Welcome to Archive', folderKey: undefined, content: 'Archive keeps notes, documents, research, and source files organized in one private workspace.' },
    { key: KEYS.roadmap, name: 'Launch roadmap', folderKey: KEYS.launch, content: 'Confirm positioning, finish onboarding, test authentication, prepare launch communication, and review activation metrics.' },
    { key: KEYS.researchNote, name: 'Research notes', folderKey: KEYS.research, content: 'Useful systems reduce friction, preserve context, and make the next action obvious.' },
    { key: KEYS.journalNote, name: 'Monday reflection', folderKey: KEYS.journal, content: 'The best work today came from protecting one quiet hour and writing the decision down before acting.' },
    { key: KEYS.readinessNote, name: 'Release readiness checklist', folderKey: KEYS.launchOperations, content: 'Confirm deployment ownership, smoke tests, rollback criteria, support coverage, status communication, and incident escalation before launch.' },
    { key: KEYS.positioningNote, name: 'Positioning hypotheses', folderKey: KEYS.launchStrategy, content: 'Test whether durable context, private knowledge retrieval, and confident next actions resonate with independent teams preparing a launch.' },
    { key: KEYS.interviewThemes, name: 'Recurring interview themes', folderKey: KEYS.interviews, content: 'Customers describe fragmented notes, duplicated decisions, slow retrieval, uncertain ownership, and difficulty turning research into a concrete next action.' },
    { key: KEYS.synthesisQuestions, name: 'Synthesis open questions', folderKey: KEYS.synthesis, content: 'Determine which retrieval signals create trust, when the system should ask for clarification, and how evidence should remain connected to decisions.' },
    { key: KEYS.quarterlyGoals, name: 'Quarterly focus', folderKey: KEYS.goals, content: 'Protect focused writing time, complete the launch milestone, review progress every Friday, and keep decisions linked to their evidence.' },
    { key: KEYS.readingQueue, name: 'Systems reading queue', folderKey: KEYS.reading, content: 'Read about calm technology, information retrieval, resilient organizations, decision records, and humane tools for focused knowledge work.' },
    { key: KEYS.pdf, name: 'Focused work reference', folderKey: KEYS.references, content: 'A short PDF reference about calm systems for focused work.', extension: 'pdf' as const, mimeType: 'application/pdf', storageKey: pdfStorageKey, sizeBytes: pdfBytes.byteLength },
    ...importedDocuments,
  ];
  const preparedDocuments = documents.map((document) => {
    const contentChunks = chunkDocumentContent(document.content);
    return { document, contentChunks, embeddingTexts: documentEmbeddingTexts(document.name, contentChunks) };
  });
  const documentEmbeddings = await embedTexts({ texts: preparedDocuments.flatMap(({ embeddingTexts }) => embeddingTexts) });
  let embeddingOffset = 0;
  for (const { document, contentChunks, embeddingTexts } of preparedDocuments) {
    const chunkEmbeddings = documentEmbeddings.slice(embeddingOffset, embeddingOffset + embeddingTexts.length);
    embeddingOffset += embeddingTexts.length;
    await upsert(DOCUMENTS_COLLECTION, documentSchema.parse({
      ...document,
      scopeKey,
      embedding: chunkEmbeddings[0],
      contentChunks,
      chunkEmbeddings,
      semanticChunkCount: contentChunks.length,
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
