import dotenv from 'dotenv';

dotenv.config();

// Read the configuration from the .env file and use the default value if there is no configuration
export const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 3;
export const RETRY_INTERVAL_MS = process.env.RETRY_INTERVAL_MS ? parseInt(process.env.RETRY_INTERVAL_MS) : 1000;
export const EXSAT_RPC_URLS = process.env.EXSAT_RPC_URLS ? JSON.parse(process.env.EXSAT_RPC_URLS) : [];
export const LOGGER_MAX_SIZE = process.env.LOGGER_MAX_SIZE || '20m';
export const LOGGER_MAX_FILES = process.env.LOGGER_MAX_FILES || '30d';
export const LOGGER_DIR = process.env.LOGGER_DIR || '~/.exsat/logs';
export const VALIDATOR_JOBS_ENDORSE = process.env.VALIDATOR_JOBS_ENDORSE || '*/10 * * * * *';
export const VALIDATOR_JOBS_ENDORSE_CHECK = process.env.VALIDATOR_JOBS_ENDORSE_CHECK || '*/5 * * * * *';
export const VALIDATOR_KEYSTORE_FILE = process.env.VALIDATOR_KEYSTORE_FILE || '';
export const VALIDATOR_KEYSTORE_PASSWORD = process.env.VALIDATOR_KEYSTORE_PASSWORD || '';
