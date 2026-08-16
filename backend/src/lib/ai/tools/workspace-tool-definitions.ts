import type { BookService } from '@/lib/books/service';
import type { EmailService } from '@/lib/email-inbox/service';
import type { TravelService } from '@/lib/travel/service';
import {
  archiveCapabilities,
  ascendCapabilities,
  compassCapabilities,
  signalCapabilities,
} from '@/lib/ai/personal-assistant/service-capabilities';
import { galleryAssistantCapabilities } from '@/lib/ai/personal-assistant/gallery-capabilities';
import type { AssistantCapability, AssistantCapabilityContext } from '@/lib/ai/personal-assistant/capabilities';
import { runContentTool, type ContentToolDependencies } from './content-runtime';
import type { DomainToolContext } from './domain-execute';

export interface WorkspaceToolDependencies {
  context: DomainToolContext;
  requestKey?: string;
  content?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  travel?: TravelService;
  email?: EmailService;
  books?: BookService;
}

function publicDefinition(capability: AssistantCapability) {
  return {
    name: capability.definition.name,
    inputSchema: capability.inputSchema,
    providerDefinition: capability.definition,
    async execute(rawInput: unknown, dependencies: WorkspaceToolDependencies) {
      const context: AssistantCapabilityContext = {
        domain: dependencies.context,
        requestKey: dependencies.requestKey,
        contentDependencies: dependencies.content,
        executeContent: dependencies.executeContent,
        travel: dependencies.travel,
        email: dependencies.email,
        books: dependencies.books,
      };
      const result = await capability.execute(rawInput, context);
      if (result.kind !== 'continue') throw new Error(`Public workspace tool ${capability.definition.name} returned a UI-only result.`);
      return result.result;
    },
  };
}

export const WORKSPACE_TOOL_DEFINITIONS = Object.freeze([
  ...archiveCapabilities,
  ...galleryAssistantCapabilities,
  ...compassCapabilities,
  ...signalCapabilities,
  ...ascendCapabilities,
].filter(({ definition }) => !new Set([
  'folder.list', 'folder.create', 'folder.update', 'folder.move', 'folder.copy',
  'document.list', 'document.find', 'document.create', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.summarize', 'document.topics', 'document.list-summaries', 'document.find-summary', 'document.summary.audio.generate', 'document.translate', 'document.list-versions', 'document.restore-version', 'document.download',
  'image.search', 'email.thread.read',
]).has(definition.name)).map(publicDefinition));
