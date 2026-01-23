/**
 * Copyright (c) 2026 Ivan Iraci <ivan.iraci@professioneit.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { ENV } from '../constants.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple logger that writes to stderr (to avoid interfering with stdio transport).
 */
class Logger {
  private level: LogLevel = 'info';

  constructor() {
    // Initialize from environment variable
    const envLevel = process.env[ENV.LOG_LEVEL];
    if (envLevel && this.isValidLevel(envLevel)) {
      this.level = envLevel;
    }
  }

  private isValidLevel(level: string): level is LogLevel {
    return level in LOG_LEVELS;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (data !== undefined) {
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      return `${prefix} ${message}\n${dataStr}`;
    }

    return `${prefix} ${message}`;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (this.shouldLog(level)) {
      const formatted = this.formatMessage(level, message, data);
      // Write to stderr to avoid interfering with stdio transport
      process.stderr.write(formatted + '\n');
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Log an error with stack trace if available.
   */
  exception(message: string, error: unknown): void {
    if (error instanceof Error) {
      this.error(message, {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    } else {
      this.error(message, error);
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for type usage
export { Logger };

// Convenience function exports
export function log(level: LogLevel, message: string, data?: unknown): void {
  switch (level) {
    case 'debug': logger.debug(message, data); break;
    case 'info': logger.info(message, data); break;
    case 'warn': logger.warn(message, data); break;
    case 'error': logger.error(message, data); break;
  }
}

export function setLogLevel(level: LogLevel): void {
  logger.setLevel(level);
}
