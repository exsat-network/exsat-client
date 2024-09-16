const { createLogger, format, transports } = require('winston');
import DailyRotateFile from 'winston-daily-rotate-file';
import { LOGGER_DIR, LOGGER_MAX_FILES, LOGGER_MAX_SIZE } from './config';

const customFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ssZ' }),
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
