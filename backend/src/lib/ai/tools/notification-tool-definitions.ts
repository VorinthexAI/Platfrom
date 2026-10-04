import { appNotifyInputSchema } from '@/lib/app-notifications/contracts';
import { appNotificationService } from '@/lib/app-notifications/service';
import { userNotificationListInputSchema, userNotificationMarkReadInputSchema } from '@/lib/user-notifications/schemas';
import { userNotificationService } from '@/lib/user-notifications/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { PublicToolDependencies } from './tool-definition';

export const appNotifyToolDefinition = {
  name: 'app.notify',
  inputSchema: appNotifyInputSchema,
  providerDefinition: { name: 'app.notify', description: 'Notify eligible users in the current scope.', inputSchema: contentZodToJsonSchema(appNotifyInputSchema) },
  isReadOnly: () => false,
  async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
    return appNotificationService.notify(appNotifyInputSchema.parse(rawInput), dependencies.context, dependencies.requestKey);
  },
};

export const notificationListToolDefinition = {
  name: 'notification.list',
  inputSchema: userNotificationListInputSchema,
  providerDefinition: { name: 'notification.list', description: 'List notifications for the authenticated user.', inputSchema: contentZodToJsonSchema(userNotificationListInputSchema) },
  isReadOnly: () => true,
  async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
    return userNotificationService.list(userNotificationListInputSchema.parse(rawInput), dependencies.context);
  },
};

export const notificationMarkReadToolDefinition = {
  name: 'notification.mark-read',
  inputSchema: userNotificationMarkReadInputSchema,
  providerDefinition: { name: 'notification.mark-read', description: 'Mark a notification read or unread.', inputSchema: contentZodToJsonSchema(userNotificationMarkReadInputSchema) },
  isReadOnly: () => false,
  async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
    return userNotificationService.markRead(userNotificationMarkReadInputSchema.parse(rawInput), dependencies.context);
  },
};
