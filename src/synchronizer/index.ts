import cron from 'node-cron';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { configureLogger, logger } from '../utils/logger';
import { envCheck } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { Client, ClientType } from '../utils/enumeration';
import { errorTotalCounter, setupPrometheus, warnTotalCounter, } from '../utils/prom';
import { BlockOperations } from './blockOperations';
import { SynchronizerJobs } from './jobs';
import { AsyncLock } from '../utils/asyncLock';
import {
  EXSAT_RPC_URLS,
  SYNCHRONIZER_JOBS_BLOCK_FORK_CHECK,
  SYNCHRONIZER_JOBS_BLOCK_PARSE,
  SYNCHRONIZER_JOBS_BLOCK_UPLOAD,
  SYNCHRONIZER_JOBS_BLOCK_VERIFY,
  SYNCHRONIZER_KEYSTORE_FILE
} from '../utils/config';

export class SynchronizerState {
  accountName: string = '';
  exsatApi: ExsatApi | null = null;
  tableApi: TableApi | null = null;
  uploadingHeight: number = 0;
  uploadLock = new AsyncLock();
  verifyLock = new AsyncLock();
  parseLock = new AsyncLock();
  forkCheckLock = new AsyncLock();
}

async function initializeAccount(): Promise<{ accountInfo: any, password: string }> {
  let password = getConfigPassword(ClientType.Synchronizer);
  let accountInfo;

  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(SYNCHRONIZER_KEYSTORE_FILE, password);
  } else {
    while (!accountInfo) {
      try {
        password = await getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(SYNCHRONIZER_KEYSTORE_FILE, password);
      } catch (e) {
        logger.warn(e);
        warnTotalCounter.inc({ account: accountInfo?.accountName, client: Client.Synchronizer });
      }
    }
  }

  return { accountInfo, password };
}

async function setupApis(accountInfo: any): Promise<{ exsatApi: ExsatApi, tableApi: TableApi }> {
  const exsatApi = new ExsatApi(accountInfo, EXSAT_RPC_URLS);
  await exsatApi.initialize();
  const tableApi = new TableApi(exsatApi);
  await exsatApi.checkClient(ClientType.Synchronizer);
  return { exsatApi, tableApi };
}

function setupCronJobs(jobs: SynchronizerJobs) {
  const cronJobs = [
    { schedule: SYNCHRONIZER_JOBS_BLOCK_UPLOAD, job: jobs.upload },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_VERIFY, job: jobs.verify },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_PARSE, job: jobs.parse },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_FORK_CHECK, job: jobs.forkCheck }
  ];

  cronJobs.forEach(({ schedule, job }) => {
    cron.schedule(schedule, async () => {
      try {
        await job();
      } catch (error) {
        logger.error(`Unhandled error in ${job.name} job:`, error);
        errorTotalCounter.inc({ account: jobs.state.accountName, client: Client.Synchronizer });
      }
    });
  });
}

async function main() {
  configureLogger(Client.Synchronizer);
  await envCheck(SYNCHRONIZER_KEYSTORE_FILE);

  const { accountInfo } = await initializeAccount();
  const { exsatApi, tableApi } = await setupApis(accountInfo);

  const state = new SynchronizerState();
  state.accountName = accountInfo.accountName;
  state.exsatApi = exsatApi;
  state.tableApi = tableApi;

  const blockOperations = new BlockOperations(exsatApi, state.accountName);
  const jobs = new SynchronizerJobs(state, blockOperations);

  setupCronJobs(jobs);
  setupPrometheus();
}

(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
