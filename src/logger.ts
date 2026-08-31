import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const root = pino(
  isProduction
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        level: process.env.LOG_LEVEL || 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      },
);

export function createLogger(module: string): pino.Logger {
  return root.child({ module });
}
