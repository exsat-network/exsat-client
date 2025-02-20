import cron from 'node-cron';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { configureLogger, logger } from '../utils/logger';
import { envCheck, loadNetworkConfigurations } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { Client, ClientType } from '../utils/enumeration';
import { errorTotalCounter, setupPrometheus, startTimeGauge, warnTotalCounter } from '../utils/prom';
import { ValidatorJobs } from './jobs';
import * as yargs from 'yargs';
import {
  EXSAT_RPC_URLS,
  HEARTBEAT_JOBS,
  VALIDATOR_JOBS_ENDORSE,
  VALIDATOR_JOBS_ENDORSE_CHECK,
  VALIDATOR_KEYSTORE_FILE,
  XSAT_VALIDATOR_KEYSTORE_FILE,
} from '../utils/config';

export class ValidatorState {
  accountName: string = '';
  client: string = '';
  exsatApi: ExsatApi | null = null;
  tableApi: TableApi | null = null;
  lastEndorseHeight: number = 0;
  startupStatus: boolean = false;
  endorseRunning: boolean = false;
  endorseCheckRunning: boolean = false;
}

async function initializeAccount(client): Promise<{
  accountInfo: any;
  password: string;
}> {
  let password = getConfigPassword(client == Client.Validator ? ClientType.Validator : ClientType.XsatValidator);
  let accountInfo;
  const keystoreFile = client == Client.Validator ? VALIDATOR_KEYSTORE_FILE : XSAT_VALIDATOR_KEYSTORE_FILE;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(keystoreFile, password);
  } else {
    while (!accountInfo) {
      try {
        password = await getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(keystoreFile, password);
      } catch (e) {
        logger.warn(e);
        warnTotalCounter.inc({
          account: accountInfo?.accountName,
          client: client,
        });
      }
    }
  }

  return { accountInfo, password };
}

async function setupApis(accountInfo: any, client): Promise<{ exsatApi: ExsatApi; tableApi: TableApi }> {
  const exsatApi = new ExsatApi(accountInfo, EXSAT_RPC_URLS);
  await exsatApi.initialize();
  const tableApi = new TableApi(exsatApi);
  await exsatApi.checkClient(client == Client.Validator ? ClientType.Validator : ClientType.XsatValidator);
  return { exsatApi, tableApi };
}

function setupCronJobs(jobs: ValidatorJobs) {
  const cronJobs = [
    { schedule: VALIDATOR_JOBS_ENDORSE, job: jobs.endorse },
    { schedule: VALIDATOR_JOBS_ENDORSE_CHECK, job: jobs.endorseCheck },
    { schedule: HEARTBEAT_JOBS, job: jobs.heartbeat },
  ];

  cronJobs.forEach(({ schedule, job }) => {
    cron.schedule(schedule, async () => {
      try {
        await job();
      } catch (error) {
        logger.error(`Unhandled error in ${job.name} job:`, error);
        errorTotalCounter.inc({
          account: jobs.state.accountName,
          client: Client.Validator,
        });
      }
    });
  });
}
async function main() {
  const client = yargs.options({
    client: { type: 'string', describe: '', default: Client.Validator },
  }).argv.client;
  if (![Client.Validator, Client.XSATValidaotr].includes(client)) {
    throw new Error(`Invalid client type: ${client}`);
  }
  await loadNetworkConfigurations();
  configureLogger(client);
  await envCheck(client == Client.Validator ? VALIDATOR_KEYSTORE_FILE : XSAT_VALIDATOR_KEYSTORE_FILE);

  const { accountInfo } = await initializeAccount(client);
  const { exsatApi, tableApi } = await setupApis(accountInfo, client);

  const state = new ValidatorState();
  state.accountName = accountInfo.accountName;
  state.client = client;
  state.exsatApi = exsatApi;
  state.tableApi = tableApi;

  const jobs = new ValidatorJobs(state);

  setupCronJobs(jobs);
  setupPrometheus();
  startTimeGauge.set({ account: accountInfo.accountName, client: client }, Date.now());
}

(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
