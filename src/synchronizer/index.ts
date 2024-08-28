import cron from 'node-cron';
import {
  CHUNK_SIZE,
  EXSAT_RPC_URLS,
  RETRY_INTERVAL_MS,
  SYNCHRONIZER_JOBS_BLOCK_PARSE,
  SYNCHRONIZER_JOBS_BLOCK_UPLOAD, SYNCHRONIZER_JOBS_BLOCK_VERIFY,
  SYNCHRONIZER_KEYSTORE_FILE
} from '../utils/config';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { getblock, getblockcount, getblockhash, getChunkMap } from '../utils/bitcoin';
import { configureLogger, logger } from '../utils/logger';
import { envCheck, sleep } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { BlockStatus, ClientType, ContractName } from '../utils/enumeration';
import moment from 'moment';

let [uploadRunning, verifyRunning, parseRunning] = [false, false, false];
let accountName: string;
let exsatApi: ExsatApi;
let tableApi: TableApi;

// Initializes a new bucket for storing block data.
async function initbucket(height: number, hash: string, block_size: number, num_chunks: number) {
  const initbucketResult: any = await exsatApi.executeAction(ContractName.blksync, 'initbucket', {
    synchronizer: accountName,
    height: height,
    hash: hash,
    block_size: block_size,
    num_chunks: num_chunks,
    chunk_size: CHUNK_SIZE
  });
  if (initbucketResult) {
    logger.info(`Init bucket success, height: ${height}, hash: ${hash}, transaction_id: ${initbucketResult.transaction_id}`);
  }
}

// Deletes an existing block bucket.
async function delbucket(height: number, hash: string) {
  const delbucketResult: any = await exsatApi.executeAction(ContractName.blksync, 'delbucket', {
      synchronizer: accountName,
      height,
      hash
    }
  );
  if (delbucketResult) {
    logger.info(`Delete bucket success, height: ${height}, hash: ${hash}, transaction_id: ${delbucketResult.transaction_id}`);
  }
}

// Pushes a chunk of block data to the bucket.
async function pushchunk(height: number, hash: string, chunkId: number, chunkData: string) {
  const pushchunkResult: any = await exsatApi.executeAction(ContractName.blksync, 'pushchunk', {
    synchronizer: accountName,
    height: height,
    hash: hash,
    chunk_id: chunkId,
    data: chunkData
  });
  if (pushchunkResult) {
    logger.info(`Push chunk success, height: ${height}, hash: ${hash}, chunk_id: ${chunkId}, transaction_id: ${pushchunkResult.transaction_id}`);
  }
}

// Verifies the integrity and status of a block.
async function verifyBlock(height: number, hash: string) {
  while (true) {
    const verifyResult: any = await exsatApi.executeAction(ContractName.blksync, 'verify', {
      synchronizer: accountName,
      height,
      hash
    });
    if (verifyResult) {
      logger.info(`Verify block success, height: ${height}, hash: ${hash}, transaction_id: ${verifyResult.transaction_id}`);
      const returnValueData = verifyResult.processed?.action_traces[0]?.return_value_data;
      if (returnValueData.status === 'verify_pass') {
        logger.info(`Block verify pass, height: ${height}, hash: ${hash}`);
        break;
      } else if (returnValueData.status === 'verify_fail') {
        logger.info(`Block verify fail, height: ${height}, hash: ${hash}, reason: ${returnValueData.reason}`);
        await delbucket(height, hash);
        break;
      }
    }
  }
}

async function setupCronJobs() {
  cron.schedule(SYNCHRONIZER_JOBS_BLOCK_UPLOAD, async () => {
    try {
      if (uploadRunning) {
        return;
      }
      uploadRunning = true;
      logger.info('Upload block task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        return;
      }
      const blockcountInfo = await getblockcount();
      if (chainstate.head_height >= blockcountInfo.result) {
        logger.info('No new block found.');
        return;
      }
      const synchronizerInfo = await tableApi.getSynchronizerInfo(accountName);
      if (!synchronizerInfo) {
        logger.error(`Get synchronizer[${accountName}] info error.`);
        return;
      }
      const holdSlots: number = synchronizerInfo.num_slots;
      let usedSlots: number = 0;
      const blockbuckets = await tableApi.getAllBlockbucket(accountName);
      if (blockbuckets && blockbuckets.length > 0) {
        usedSlots = blockbuckets.length;
      }
      if (usedSlots >= holdSlots) {
        logger.info(`The number of blockbuckets[${usedSlots}] has reached the upper limit[${holdSlots}], Please purchase more slots or wait for the slots to be released`);
        return;
      }
      for (let height = chainstate.head_height + 1; height <= blockcountInfo.result && usedSlots < holdSlots; height++) {
        //upload next bitcoin block
        const blockhashInfo = await getblockhash(height);
        const hash = blockhashInfo.result;
        try {
          const blockInfo = await getblock(hash);
          if (blockInfo) {
            if (blockInfo.result === null && blockInfo.error?.code === -5) {
              logger.info(`Block not found, height: ${height}, hash: ${hash}`);
              return;
            } else if (blockInfo.error) {
              logger.error(`Get block raw error, height: ${height}, hash: ${hash}`, blockInfo.error);
              return;
            }
          }
          const blockRaw = blockInfo.result;
          const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
          await initbucket(height, hash, blockRaw.length / 2, chunkMap.size);
          for (const item of chunkMap) {
            await pushchunk(height, hash, item[0], item[1]);
          }
        } catch (e: any) {
          const errorMessage = e?.message || '';
          if (errorMessage.includes('duplicate transaction')) {
            //Ignore duplicate transaction
            await sleep(RETRY_INTERVAL_MS);
          } else if (errorMessage.includes('blksync.xsat::initbucket: the block has reached consensus')) {
            logger.info(`The block has reached consensus, height: ${height}, hash: ${hash}`);
          } else if (errorMessage.includes('blksync.xsat::pushchunk: cannot push chunk in the current state [verify_merkle]')) {
            //Ignore
          } else {
            logger.error(`Upload block task error, height: ${height}, hash: ${hash}`, e);
            await sleep(RETRY_INTERVAL_MS);
          }
        }
      }
    } catch (e: any) {
      logger.error(`Upload block task error`, e);
    } finally {
      uploadRunning = false;
    }
  });

  cron.schedule(SYNCHRONIZER_JOBS_BLOCK_VERIFY, async () => {
    let logHeight: number = 0;
    let logHash: string = '';
    try {
      if (verifyRunning) {
        return;
      }
      verifyRunning = true;
      logger.info('Verify block task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        return;
      }
      const blockbuckets = await tableApi.getAllBlockbucket(accountName);
      if (!blockbuckets || blockbuckets.length === 0) {
        logger.info('No blockbucket found.');
        return;
      }
      for (const blockbucket of blockbuckets) {
        const {
          height,
          hash,
          status,
          size,
          uploaded_size,
          num_chunks,
          uploaded_num_chunks,
          chunk_size
        } = blockbucket;
        logHeight = height;
        logHash = hash;
        logger.info(`Blockbucket, status: ${status}, height: ${height}, hash: ${hash}`);
        switch (status) {
          case BlockStatus.UPLOADING:
            const blockInfo = await getblock(hash);
            if (blockInfo) {
              if (blockInfo.result === null && blockInfo.error?.code === -5) {
                logger.info(`Block not found, height: ${height}, hash: ${hash}`);
                await delbucket(height, hash);
                break;
              } else if (blockInfo.error) {
                logger.error(`Get block raw error, height: ${height}, hash: ${hash}`, blockInfo.error);
                break;
              }
            }
            const blockRaw = blockInfo.result;
            //Block sharding
            const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
            if ((size === uploaded_size && num_chunks !== uploaded_num_chunks)
              || (size !== uploaded_size && num_chunks === uploaded_num_chunks)
              || chunk_size !== CHUNK_SIZE) {
              logger.info(`Blockbucket size and uploaded_size are inconsistent`);
              //Delete the block first, then initialize and re-upload
              await delbucket(height, hash);
              await initbucket(height, hash, blockRaw.length / 2, chunkMap.size);
            }
            /*while (true) {
              const newBlockbucket = await tableApi.getBlockbucketById(accountName, blockbucket.id);
              if (!newBlockbucket) {
                break;
              }
              for (const item of chunkMap) {
                const chunkId: number = item[0];
                const chunkData: string = item[1];
                if (newBlockbucket.chunk_ids.includes(chunkId)) {
                  continue;
                }
                await pushchunk(height, hash, chunkId, chunkData);
              await sleep(5000); //todo
              }
            }*/
            const newBlockbucket = await tableApi.getBlockbucketById(accountName, blockbucket.id);
            if (!newBlockbucket) {
              break;
            }
            for (const item of chunkMap) {
              const chunkId: number = item[0];
              const chunkData: string = item[1];
              if (newBlockbucket.chunk_ids.includes(chunkId)) {
                continue;
              }
              await pushchunk(height, hash, chunkId, chunkData);
            }
            break;
          case BlockStatus.UPLOAD_COMPLETE:
          case BlockStatus.VERIFY_MERKLE:
          case BlockStatus.VERIFY_PARENT_HASH:
            await verifyBlock(height, hash);
            break;
          case BlockStatus.WAITING_MINER_VERIFICATION:
            const consensusBlk = await tableApi.getConsensusByBucketId(accountName, blockbucket.id);
            if (consensusBlk || chainstate.irreversible_height >= blockbucket.height) {
              //The block has been completed by consensus and can be deleted
              await delbucket(height, hash);
            } else {
              await verifyBlock(height, hash);
            }
            break;
          case BlockStatus.VERIFY_PASS:
            logger.info(`Block verify pass, Wait for the validator to endorse the block, height: ${height}, hash: ${hash}`);
            break;
          default:
            break;
        }
      }
    } catch (e: any) {
      const errorMessage = e?.message || '';
      if (errorMessage.includes('blksync.xsat::delbucket: [blockbuckets] does not exists')) {
        logger.info('blockbucket has been deleted.');
      } else if (errorMessage.includes('duplicate transaction')) {
        //Ignore duplicate transaction
      } else if (errorMessage.includes('blksync.xsat::initbucket: the block has reached consensus')) {
        logger.info(`The block has reached consensus, height: ${logHeight}, hash: ${logHash}`);
      } else if (errorMessage.includes('blksync.xsat::verify: you have not uploaded the block data. please upload it first and then verify it')) {
        //Ignore
      } else if (errorMessage.includes('blksync.xsat::pushchunk: cannot push chunk in the current state [verify_merkle]')) {
        //Ignore
      } else {
        logger.error(`Upload and verify block task error, height: ${logHeight}, hash: ${logHash}`, e);
        await sleep(RETRY_INTERVAL_MS);
      }
    } finally {
      verifyRunning = false;
    }
  });

  cron.schedule(SYNCHRONIZER_JOBS_BLOCK_PARSE, async () => {
    try {
      if (parseRunning) {
        return;
      }
      parseRunning = true;
      logger.info('Parse block task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        return;
      }
      for (const item of chainstate.parsing_progress_of) {
        const parseInfo = item.second;
        if (parseInfo.parser === accountName || moment.utc().isAfter(moment.utc(parseInfo.parse_expiration_time))) {
          let processRows: number = 2000;
          while (true) {
            try {
              const parseResult: any = await exsatApi.executeAction(ContractName.utxomng, 'processblock', {
                synchronizer: accountName,
                process_rows: processRows,
              });
              if (parseResult) {
                logger.info(`Parse block success, transaction_id: ${parseResult.transaction_id}`);
                const returnValueDate = parseResult.processed?.action_traces[0]?.return_value_data;
                if (returnValueDate.status !== 'parsing') {
                  break;
                }
              }
            } catch (e: any) {
              if (e.message.includes('reached node configured max-transaction-time')) {
                processRows = Math.ceil(processRows * 0.618);
              } else if (e.message.includes('duplicate transaction')) {
                //Ignore duplicate transaction
                await sleep(RETRY_INTERVAL_MS);
              } else {
                logger.error(`Parse block failed, height=${chainstate.head_height}, stack=${e.stack}`);
                await sleep(RETRY_INTERVAL_MS);
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      logger.error('Parse block task error', e);
      await sleep(RETRY_INTERVAL_MS);
    } finally {
      parseRunning = false;
    }
  });
}

async function main() {
  configureLogger('synchronizer');
  await envCheck(SYNCHRONIZER_KEYSTORE_FILE);
  let password = getConfigPassword(ClientType.Synchronizer);
  let accountInfo;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(SYNCHRONIZER_KEYSTORE_FILE, password);
  } else {
    while (!accountInfo) {
      try {
        password = getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(SYNCHRONIZER_KEYSTORE_FILE, password);
      } catch (e) {
        logger.warn(e);
      }
    }
  }
  accountName = accountInfo.accountName;
  exsatApi = new ExsatApi(accountInfo, EXSAT_RPC_URLS);
  await exsatApi.initialize();
  tableApi = new TableApi(exsatApi);
  await exsatApi.checkClient(ClientType.Synchronizer);
}

(async () => {
  try {
    await main();
    await setupCronJobs();
  } catch (e) {
    logger.error(e);
  }
})();
