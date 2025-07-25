import DailyRotateFile from 'winston-daily-rotate-file';
import { IS_DOCKER, LOGGER_MAX_FILES, LOGGER_MAX_SIZE } from './config';

const { createLogger, format, transports } = require('winston');

const customFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  format.errors({ stack: true }),
  format.splat(),
  format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
);

const consoleTransport = new transports.Console({
  format: format.combine(
    format.colorize(),
    format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
});

// Create a new Winston logger instance
export const logger = createLogger({
  format: customFormat,
});

export function configureLogger(clientType: string) {
  const LOGGER_DIR = IS_DOCKER ? '/app/.exsat/logs' : 'logs';
  const fileTransport = new DailyRotateFile({
    level: 'info',
    filename: `${LOGGER_DIR}/${clientType}/info-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: LOGGER_MAX_SIZE,
    maxFiles: LOGGER_MAX_FILES,
  });

  logger.configure({
    transports: [fileTransport],
  });
  logger.add(consoleTransport);
}
