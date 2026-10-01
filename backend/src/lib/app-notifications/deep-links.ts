export function homeDeepLinkUrl(environment: NodeJS.ProcessEnv = process.env) {
  const origin = (environment.FRONTEND_URL ?? environment.FRONTEND_AUTH_URL ?? '').trim().replace(/\/$/, '');
  if (!origin) throw new Error('FRONTEND_URL is required for home deep links.');
  return new URL('/home', `${origin}/`).toString();
}

export function generatedFileDeepLinkUrl(fileKey: string, scopeKey: string, environment: NodeJS.ProcessEnv = process.env) {
  const origin = (environment.FRONTEND_URL ?? environment.FRONTEND_AUTH_URL ?? '').trim().replace(/\/$/, '');
  if (!origin) throw new Error('FRONTEND_URL is required for file deep links.');
  const url = new URL('/file', `${origin}/`);
  url.searchParams.set('fileKey', fileKey);
  url.searchParams.set('scopeKey', scopeKey);
  return url.toString();
}
