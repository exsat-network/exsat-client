import cron from 'node-cron';
import { configureLogger, logger } from '../utils/logger';
import { envCheck, initializeAccount, loadNetworkConfigurations } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { Client, ClientType } from '../utils/enumeration';
import { errorTotalCounter, setupPrometheus, startTimeGauge, warnTotalCounter } from '../utils/prom';
import { BlockOperations } from './blockOperations';
import { SynchronizerJobs } from './jobs';
import {
  EXSAT_RPC_URLS,
  HEARTBEAT_JOBS,
  SYNCHRONIZER_JOBS_BLOCK_PARSE,
  SYNCHRONIZER_JOBS_BLOCK_UPLOAD,
  SYNCHRONIZER_JOBS_BLOCK_VERIFY,
} from '../utils/config';
import ExsatNode from '../utils/exsat-node';

export class SynchronizerState {
  accountName: string = '';
  exsatApi: ExsatApi | null = null;
  tableApi: TableApi | null = null;
  uploadRunning = false;
  verifyRunning = false;
  parseRunning = false;
}

async function setupApis(accountInfo: any): Promise<{ exsatApi: ExsatApi; tableApi: TableApi }> {
  const exsatNode = new ExsatNode(EXSAT_RPC_URLS);
  const exsatApi = new ExsatApi(accountInfo, exsatNode);
  await exsatApi.initialize();
  const tableApi = await TableApi.getInstance();
  await exsatApi.checkClient(Client.Synchronizer);
  return { exsatApi, tableApi };
}

function setupCronJobs(jobs: SynchronizerJobs) {
  const cronJobs = [
    { schedule: SYNCHRONIZER_JOBS_BLOCK_UPLOAD, job: jobs.upload },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_VERIFY, job: jobs.verify },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_PARSE, job: jobs.parse },
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
          client: Client.Synchronizer,
        });
      }
    });
  });
}

async function main() {
  await loadNetworkConfigurations();
  configureLogger(Client.Synchronizer);
  await envCheck(ClientType.Synchronizer);

  const { accountInfo } = await initializeAccount(ClientType.Synchronizer);
  const { exsatApi, tableApi } = await setupApis(accountInfo);

  const state = new SynchronizerState();
  state.accountName = accountInfo.accountName;
  state.exsatApi = exsatApi;
  state.tableApi = tableApi;

  const blockOperations = new BlockOperations(exsatApi, state.accountName);
  const jobs = new SynchronizerJobs(state, blockOperations);

  setupCronJobs(jobs);
  setupPrometheus();
  startTimeGauge.set({ account: accountInfo.accountName, client: Client.Synchronizer }, Date.now());
}

(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
