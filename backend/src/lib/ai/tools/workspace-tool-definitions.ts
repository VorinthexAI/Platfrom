import type { BookService } from '@/lib/books/service';
import type { EmailService } from '@/lib/email-inbox/service';
import type { TravelService } from '@/lib/travel/service';
import type { UserHiddenService } from '@/lib/user-hiddens/service';
import type { CountrySearchService } from '@/lib/travel/country-search';
import {
  appSearchCapability,
  appEnhanceCapability,
  appTranslateCapability,
  appSpeechCapability,
  archiveCapabilities,
  ascendCapabilities,
  compassCapabilities,
  hiddenListCapability,
  signalCapabilities,
} from '@/lib/ai/personal-assistant/service-capabilities';
import { galleryAssistantCapabilities } from '@/lib/ai/personal-assistant/gallery-capabilities';
import type { AssistantCapability, AssistantCapabilityContext } from '@/lib/ai/personal-assistant/capabilities';
import { runContentTool, type ContentToolDependencies } from './content-runtime';
import type { ToolContext } from './tool-context';
import type { AppSearchService } from '@/lib/app-search/service';
import type { AppTransformationService } from '@/lib/app-transformation/service';
import type { AppSpeechService } from '@/lib/app-speech/service';

export interface WorkspaceToolDependencies {
  context: ToolContext;
  requestKey?: string;
  content?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  travel?: TravelService;
  countries?: CountrySearchService;
  email?: EmailService;
  books?: BookService;
  userHiddens?: UserHiddenService;
  gallery?: AssistantCapabilityContext['gallery'];
  images?: AssistantCapabilityContext['images'];
  appSearch?: AppSearchService;
  appTransformation?: AppTransformationService;
  appSpeech?: AppSpeechService;
  signal?: AbortSignal;
  timeoutMs?: number;
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
        clientRequestKey: dependencies.requestKey ?? null,
        contentDependencies: dependencies.content,
        executeContent: dependencies.executeContent,
        travel: dependencies.travel,
        countries: dependencies.countries,
        email: dependencies.email,
        books: dependencies.books,
        userHiddens: dependencies.userHiddens,
        gallery: dependencies.gallery,
        images: dependencies.images,
        appSearch: dependencies.appSearch,
        appTransformation: dependencies.appTransformation,
        appSpeech: dependencies.appSpeech,
        signal: dependencies.signal,
        timeoutMs: dependencies.timeoutMs,
      };
      const result = await capability.execute(rawInput, context);
      if (result.kind !== 'continue') throw new Error(`Public workspace tool ${capability.definition.name} returned a UI-only result.`);
      return result.result;
    },
  };
}

export const WORKSPACE_TOOL_DEFINITIONS = Object.freeze([
  ...[
    appSearchCapability,
    appEnhanceCapability,
    appTranslateCapability,
    appSpeechCapability,
    hiddenListCapability,
    ...archiveCapabilities,
    ...galleryAssistantCapabilities,
    ...compassCapabilities,
    ...signalCapabilities,
    ...ascendCapabilities,
  ].filter(({ definition }) => !new Set([
    'folder.list', 'folder.create', 'folder.update', 'folder.move', 'folder.copy',
    'document.list', 'document.find', 'document.create', 'document.update', 'document.rename', 'document.move', 'document.copy', 'document.summarize', 'document.topics', 'document.list-summaries', 'document.find-summary', 'document.audio.playback.update', 'document.audio.playback.clear', 'document.list-versions', 'document.restore-version', 'document.download',
    'content.neighbors', 'content.search-history.delete',
  ]).has(definition.name)).map(publicDefinition),
]);
