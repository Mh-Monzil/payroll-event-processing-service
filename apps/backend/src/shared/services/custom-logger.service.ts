import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CustomLogger extends Logger {
  logWithTag(tag: string, message: string, context?: unknown): void {
    super.log(`[${tag}] ${this.format(message, context)}`);
  }

  warnWithTag(tag: string, message: string, context?: unknown): void {
    super.warn(`[${tag}] ${this.format(message, context)}`);
  }

  debugWithTag(tag: string, message: string, context?: unknown): void {
    super.debug(`[${tag}] ${this.format(message, context)}`);
  }

  errorWithTag(tag: string, message: string, error?: unknown): void {
    let text = message;

    if (error instanceof Error) {
      text = `${message} - ${error.message}`;
      super.error(`[${tag}] ${text}`, error.stack);
      return;
    }

    if (error !== undefined) {
      text = `${message} - ${this.stringify(error)}`;
    }

    super.error(`[${tag}] ${text}`);
  }

  private format(message: string, context?: unknown): string {
    return context === undefined
      ? message
      : `${message} - ${this.stringify(context)}`;
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
