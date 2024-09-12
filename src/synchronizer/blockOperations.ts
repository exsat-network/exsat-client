import { Client, ContractName } from '../utils/enumeration';
import { logger } from '../utils/logger';
import { blockUploadTotalCounter, syncLatestBlockGauge, syncLatestTimeGauge } from '../utils/prom';
import ExsatApi from '../utils/exsat-api';
import { CHUNK_SIZE } from '../utils/config';

export class BlockOperations {
  constructor(private exsatApi: ExsatApi, private accountName: string) {
  }

  // Initializes a new bucket for storing block data.
  async initbucket(caller: string, height: number, hash: string, block_size: number, num_chunks: number) {
    const result: any = await this.exsatApi.executeAction(ContractName.blksync, 'initbucket', {
      synchronizer: this.accountName,
      height,
      hash,
      block_size,
      num_chunks,
      chunk_size: CHUNK_SIZE
    });
    if (result) {
      logger.info(`[${caller}] Init bucket success, height: ${height}, hash: ${hash}, transaction_id: ${result.transaction_id}`);
      blockUploadTotalCounter.inc({ account: this.accountName, client: Client.Synchronizer, status: 'init' });
    }
  }

  // Deletes an existing block bucket.
  async delbucket(caller: string, height: number, hash: string) {
    logger.info(`[${caller}] delbucket, height: ${height}, hash: ${hash}`);
    const result: any = await this.exsatApi.executeAction(ContractName.blksync, 'delbucket', {
      synchronizer: this.accountName,
      height,
      hash
    });
    if (result) {
      logger.info(`[${caller}] delbucket success, height: ${height}, hash: ${hash}, transaction_id: ${result.transaction_id}`);
      blockUploadTotalCounter.inc({ account: this.accountName, client: Client.Synchronizer, status: 'delete' });
    }
  }

  // Pushes a chunk of block data to the bucket.
  async pushchunk(caller: string, height: number, hash: string, chunkId: number, chunkData: string) {
    const result: any = await this.exsatApi.executeAction(ContractName.blksync, 'pushchunk', {
      synchronizer: this.accountName,
      height,
      hash,
      chunk_id: chunkId,
      data: chunkData
    });
    if (result) {
      logger.info(`[${caller}] Push chunk success, height: ${height}, hash: ${hash}, chunk_id: ${chunkId}, transaction_id: ${result.transaction_id}`);
      blockUploadTotalCounter.inc({ account: this.accountName, client: Client.Synchronizer, status: 'push' });
    }
  }

  // Verifies the integrity and status of a block.
  async verifyBlock(caller: string, height: number, hash: string) {
    while (true) {
      const result: any = await this.exsatApi.executeAction(ContractName.blksync, 'verify', {
        synchronizer: this.accountName,
        height,
        hash
      });
      if (result) {
        logger.info(`[${caller}] Verify block success, height: ${height}, hash: ${hash}, transaction_id: ${result.transaction_id}`);
        const returnValueData = result.processed?.action_traces[0]?.return_value_data;
        if (returnValueData.status === 'verify_pass') {
          logger.info(`[${caller}] Block verify pass, height: ${height}, hash: ${hash}`);
          syncLatestBlockGauge.set({ account: this.accountName, client: Client.Synchronizer }, height);
          blockUploadTotalCounter.inc({
            account: this.accountName,
            client: Client.Synchronizer,
            status: 'verify_pass'
          });
          syncLatestTimeGauge.set({ account: this.accountName, client: Client.Synchronizer }, Date.now());
          break;
        } else if (returnValueData.status === 'verify_fail') {
          logger.info(`[${caller}] delbucket: Block verify fail, height: ${height}, hash: ${hash}, reason: ${returnValueData.reason}`);
          blockUploadTotalCounter.inc({
            account: this.accountName,
            client: Client.Synchronizer,
            status: 'verify_fail'
          });
          break;
        }
      }
    }
  }
}
