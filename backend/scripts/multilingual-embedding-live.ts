import { embedTexts } from '@/lib/embeddings';

const cases = [
  { label: 'Swedish travel', query: 'Hitta mina avslutade resor', relevant: 'completed travel plans and past trips', unrelated: 'orange cat photographs in the snow' },
  { label: 'Spanish email', query: 'Busca mis borradores de correo sin enviar', relevant: 'unsent email drafts awaiting review', unrelated: 'saved countries and travel destinations' },
  { label: 'German books', query: 'Zeig meine Lieblingshörbücher', relevant: 'favorite audio books in the library', unrelated: 'urgent unread inbox messages' },
  { label: 'English typo', query: 'find my quaterly rodmap docuemnts', relevant: 'quarterly project roadmap documents', unrelated: 'summer vacation image collections' },
] as const;

function cosine(left: number[], right: number[]) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  if (!leftNorm || !rightNorm) throw new Error('Embedding provider returned a zero-length vector.');
  return dot / Math.sqrt(leftNorm * rightNorm);
}

const inputs = cases.flatMap(({ query, relevant, unrelated }) => [query, relevant, unrelated]);
const vectors = await embedTexts({ texts: inputs, purpose: 'query', timeoutMs: 60_000 });
for (const [index, entry] of cases.entries()) {
  const [query, relevant, unrelated] = vectors.slice(index * 3, index * 3 + 3) as [number[], number[], number[]];
  const relevantScore = cosine(query, relevant);
  const unrelatedScore = cosine(query, unrelated);
  if (relevantScore <= unrelatedScore + 0.02) throw new Error(`${entry.label} failed: relevant=${relevantScore.toFixed(4)}, unrelated=${unrelatedScore.toFixed(4)}.`);
  console.log(`${entry.label}: relevant=${relevantScore.toFixed(4)}, unrelated=${unrelatedScore.toFixed(4)}`);
}

console.log(`Multilingual embedding evaluation passed ${cases.length} cases.`);
