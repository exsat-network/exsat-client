import { reloadEnv } from './common';
import { NetworkConfig } from './enumeration';

reloadEnv();

export const IS_DOCKER: boolean = process.env.RUNNING_IN_DOCKER === 'true';
// Read the configuration from the .env file and use the default value if there is no configuration
export const MAX_RETRIES: number = parseInt(process.env.MAX_RETRIES) || 3;
export const RETRY_INTERVAL_MS: number = process.env.RETRY_INTERVAL_MS ? parseInt(process.env.RETRY_INTERVAL_MS) : 2000;
export const HTTP_TIMEOUT: number = parseInt(process.env.HTTP_TIMEOUT) || 10000;
export let EXSAT_RPC_URLS: string[] = process.env.EXSAT_RPC_URLS ? JSON.parse(process.env.EXSAT_RPC_URLS) : [];
export const RES_PERMISSION: string = process.env.RES_PERMISSION;

export const LOGGER_MAX_SIZE: string = process.env.LOGGER_MAX_SIZE || '30m';
export const LOGGER_MAX_FILES: string = process.env.LOGGER_MAX_FILES || '30d';

export const BTC_RPC_URL: string = process.env.BTC_RPC_URL;
export const BTC_RPC_USERNAME: string = process.env.BTC_RPC_USERNAME;
export const BTC_RPC_PASSWORD: string = process.env.BTC_RPC_PASSWORD;

export const HEARTBEAT_JOBS: string = '0 */10 * * * *';

//  Size of each upload chunk (256 KB). Be careful! Modifying this configuration may cause block uploading failure. It must not be less than 100 KB.
export const CHUNK_SIZE: number = parseInt(process.env.CHUNK_SIZE) || 262144;
export const PROCESS_ROWS: number = parseInt(process.env.PROCESS_ROWS) || 1000;
export const PARSING_PROCESS_ROWS = parseInt(process.env.PARSING_PROCESS_ROWS) || 2000;
export const SYNCHRONIZER_JOBS_BLOCK_UPLOAD: string = process.env.SYNCHRONIZER_JOBS_BLOCK_UPLOAD || '*/1 * * * * *';
export const SYNCHRONIZER_JOBS_BLOCK_VERIFY: string = process.env.SYNCHRONIZER_JOBS_BLOCK_VERIFY || '*/1 * * * * *';
export const SYNCHRONIZER_JOBS_BLOCK_PARSE: string = process.env.SYNCHRONIZER_JOBS_BLOCK_PARSE || '*/5 * * * * *';
export const SYNCHRONIZER_KEYSTORE_FILE: string = process.env.SYNCHRONIZER_KEYSTORE_FILE || '';
export const SYNCHRONIZER_KEYSTORE_PASSWORD: string = process.env.SYNCHRONIZER_KEYSTORE_PASSWORD || '';

export const VALIDATOR_JOBS_ENDORSE: string = process.env.VALIDATOR_JOBS_ENDORSE || '*/5 * * * * *';
export const VALIDATOR_JOBS_ENDORSE_CHECK: string = process.env.VALIDATOR_JOBS_ENDORSE_CHECK || '0 * * * * *';
export const VALIDATOR_KEYSTORE_FILE: string = process.env.VALIDATOR_KEYSTORE_FILE || '';

export const VALIDATOR_KEYSTORE_PASSWORD: string = process.env.VALIDATOR_KEYSTORE_PASSWORD || '';

export const PROMETHEUS: boolean = process.env.PROMETHEUS === 'true';
export const PROMETHEUS_ADDRESS: string = process.env.PROMETHEUS_ADDRESS || '0.0.0.0:9900';

export let NETWORK_CONFIG: NetworkConfig;
export const NETWORK: string = process.env.NETWORK || 'mainnet';

export function setExsatRpcUrls(urls: string[]) {
  EXSAT_RPC_URLS = urls;
}

export function setNetworkConfig(networkConfig: any) {
  NETWORK_CONFIG = networkConfig;
}
