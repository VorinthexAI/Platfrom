const disclosureIntent = /\b(what|which|show|list|tell|reveal|describe|give|dump|print|expose|how is|how are|visa|vilka|vad ar|beratta|avsloja|lista|beskriv|muestra|cuales|revela|describe|dime|montre|quels|revele|decris|zeige|welche|enthulle|beschreibe)\b/;
const protectedTarget = /\b(system prompt|developer prompt|hidden instructions?|tool schemas?|source code|codebase|api keys?|credentials?|environment variables?|database (?:fields?|schema|structure|tables?|collections?)|collection (?:fields?|schema|structure)|table (?:fields?|schema|structure)|internal fields?|databas(?:ens)? (?:falt|schema|struktur|tabeller|samlingar)|kallkod|systemprompt|dolda instruktioner|base de datos|datenbank)\b/;
const platformOwner = /\b(vorinthex|platform|plattform(?:en|ens)?|internal|intern(?:a|t)?|our|vara|vart)\b/;
const refusal = /\b(cannot|can't|will not|won't|do not|don't|refuse|kan inte|kommer inte|far inte)\b.{0,80}\b(reveal|provide|show|disclose|share|avsl(?:o|ö)ja|visa|lamna ut)\b/;
const explicitSecret = /\b(?:sk-[a-z0-9_-]{16,}|akia[0-9a-z]{16}|(?:api[_ -]?key|secret|password|token)\s*[:=]\s*["']?[a-z0-9_./+=-]{12,})\b|-----begin (?:rsa |ec |openssh )?private key-----/i;

function normalized(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[_`'"()[\]{}:;,.!?/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** High-precision deterministic backstop; broader cases remain covered by the model policy. */
export function requestsPlatformInternals(message: string) {
  const value = normalized(message);
  return disclosureIntent.test(value) && protectedTarget.test(value);
}

/** Rejects high-confidence generated disclosures without blocking ordinary user-owned content. */
export function disclosesPlatformInternals(message: string) {
  if (explicitSecret.test(message)) return true;
  const value = normalized(message);
  return !refusal.test(value) && platformOwner.test(value) && protectedTarget.test(value);
}

export function protectPlatformOutput(message: string) {
  return disclosesPlatformInternals(message) ? PLATFORM_INTERNALS_REFUSAL : message;
}

export const PLATFORM_INTERNALS_REFUSAL = 'I cannot provide Vorinthex internal implementation details.';
