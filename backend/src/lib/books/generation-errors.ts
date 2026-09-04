export class BookGenerationTerminalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BookGenerationTerminalError';
  }
}
