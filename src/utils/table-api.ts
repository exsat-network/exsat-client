import { ContractName, IndexPosition, KeyType } from './enumeration';
import { computeBlockId } from './key';
import { logger } from './logger';
import { API, Checksum256, Name, UInt64, APIClient, FetchProvider } from '@wharfkit/session';
import ExsatNode from './exsat-node';
import { sleep } from './common';

let tableApiInstance: TableApi | null;

class TableApi {
  private client: APIClient;
  private exsatNodesManager: ExsatNode;
  private maxRetries: number = 3;
  private retryDelay: number = 1000;

  constructor(exsatNode: ExsatNode) {
    this.exsatNodesManager = exsatNode;
  }

  public static async getInstance(): Promise<TableApi> {
    if (!tableApiInstance) {
      try {
        tableApiInstance = new TableApi(new ExsatNode());
        await tableApiInstance.initialize();
      } catch (error) {
        tableApiInstance = null;
        throw error;
      }
    }
    return tableApiInstance;
  }

  private async initialize(): Promise<void> {
    const validNodeFound = await this.exsatNodesManager.findValidNode();
    if (!validNodeFound) {
      throw new Error('No valid exsat node available.');
    }
    this.client = new APIClient(new FetchProvider(this.exsatNodesManager.getCurrentNode()));

    logger.info('TableApi initialized successfully.');
  }

  private async retryWithExponentialBackoff<T>(operation: () => Promise<T>, retryCount: number = 0): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retryCount >= this.maxRetries) {
        throw error;
      }

      const delay = this.retryDelay * Math.pow(2, retryCount);
      logger.warn(`Operation failed, retrying in ${delay}ms...`);
      await sleep(delay);

      let switchRetryCount = 0;
      while (!(await this.switchNode())) {
        const sleepTime = Math.min(1000 * Math.pow(2, switchRetryCount), 10000);
        logger.warn(`All nodes are unavailable. Sleeping for ${sleepTime / 1000} seconds.`);
        await sleep(sleepTime);
        switchRetryCount++;
      }
      this.client = new APIClient(new FetchProvider(this.exsatNodesManager.getCurrentNode()));

      return await this.retryWithExponentialBackoff(operation, retryCount + 1);
    }
  }

  public async getTableRows<T>(
    code: string,
    scope: string | number,
    table: string,
    options: {
      limit?: number;
      lower_bound?: API.v1.TableIndexType;
      upper_bound?: API.v1.TableIndexType;
      index_position?:
        | IndexPosition.Primary
        | IndexPosition.Secondary
        | IndexPosition.Tertiary
        | IndexPosition.Fourth
        | IndexPosition.Fifth
        | IndexPosition.Sixth
        | IndexPosition.Seventh
        | IndexPosition.Eighth
        | IndexPosition.Ninth
        | IndexPosition.Tenth;
      key_type?: keyof API.v1.TableIndexTypes;
      reverse?: boolean;
      fetch_all?: boolean;
    } = {
      fetch_all: false,
    }
  ): Promise<T[]> {
    return await this.retryWithExponentialBackoff(async () => {
      let rows: T[] = [];
      let lower_bound = options.lower_bound;
      let more = true;

      do {
        const result = await this.client.v1.chain.get_table_rows({
          json: true,
          code,
          scope: String(scope),
          table,
          limit: options.limit || 10,
          lower_bound: lower_bound,
          upper_bound: options.upper_bound,
          index_position: options.index_position,
          key_type: options.key_type,
          reverse: false,
          show_payer: false,
        });

        rows = rows.concat(result.rows as T[]);
        more = result.more;
        if (more && options.fetch_all) {
          lower_bound = result.next_key as API.v1.TableIndexType;
        } else {
          more = false;
        }
      } while (more && options.fetch_all);
      return rows;
    });
  }

  /**
   * Checks if the exSat network has started.
   * @returns A boolean indicating the startup status.
   */
  public async getStartupStatus() {
    const rows: any = await this.getTableRows(ContractName.blkendt, ContractName.blkendt, 'config');
    if (rows) {
      if (rows.length === 0) {
        return true;
      } else {
        return rows[0].limit_endorse_height >= 0;
      }
    }
    return false;
  }

  /**
   * Gets endorsement information by block height and hash.
   * @param height - The block height.
   * @param hash - The block hash.
   * @returns The endorsement data or null if not found.
   */
  public async getEndorsementByBlockId(height: number, hash: string): Promise<any> {
    const rows = await this.getTableRows(ContractName.blkendt, height, 'endorsements', {
      index_position: IndexPosition.Secondary,
      upper_bound: Checksum256.from(hash),
      lower_bound: Checksum256.from(hash),
      key_type: KeyType.Sha256,
      limit: 1,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the current chain state.
   * @returns The chain state data or null if not found.
   */
  public async getChainstate(): Promise<any> {
    const rows = await this.getTableRows(ContractName.utxomng, ContractName.utxomng, 'chainstate');
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the synchronizer information by account name.
   * @param synchronizer
   */
  public async getSynchronizerInfo(synchronizer: string): Promise<any> {
    const rows = await this.getTableRows(ContractName.poolreg, ContractName.poolreg, 'synchronizer', {
      limit: 1,
      lower_bound: Name.from(synchronizer),
      upper_bound: Name.from(synchronizer),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the validator information by account name.
   * @param validator
   */
  public async getValidatorInfo(validator: string): Promise<any> {
    const rows = await this.getTableRows(ContractName.endrmng, ContractName.endrmng, 'validators', {
      limit: 1,
      lower_bound: Name.from(validator),
      upper_bound: Name.from(validator),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * get account balance
   */
  public async getAccountBalance(account: string): Promise<any> {
    const rows: any[] = await this.getTableRows(ContractName.rescmng, ContractName.rescmng, 'accounts', {
      limit: 1,
      lower_bound: Name.from(account),
      upper_bound: Name.from(account),
    });
    if (rows && rows.length > 0) {
      return rows[0].balance;
    }
    return 0;
  }

  /**
   * Retrieves a block bucket by its ID.
   * @param synchronizer - The synchronizer account name.
   * @param bucketId - The bucket ID.
   * @returns The block bucket data or null if not found.
   */
  public async getBlockbucketById(synchronizer: string, bucketId: number): Promise<any> {
    const rows = await this.getTableRows(ContractName.blksync, synchronizer, 'blockbuckets', {
      index_position: IndexPosition.Primary,
      upper_bound: UInt64.from(bucketId),
      lower_bound: UInt64.from(bucketId),
      key_type: KeyType.I64,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves all block buckets for a given synchronizer.
   * @param caller
   * @param synchronizer - The synchronizer account name.
   * @returns An array of block buckets.
   */
  public async getAllBlockbucket(caller: string, synchronizer: string): Promise<any> {
    const rows = await this.getTableRows(ContractName.blksync, synchronizer, 'blockbuckets', {
      fetch_all: true,
    });
    if (rows && rows.length > 0) {
      const heights: string = rows.map((item: any) => item.height).join(', ');
      logger.info(`[${caller}] all blockbuckets height: [${heights}]`);
      return rows.sort((a: any, b: any) => a.height - b.height);
    } else {
      logger.info(`[${caller}] no blockbuckets found`);
    }
    return rows;
  }

  /**
   * Retrieves consensus data for a block bucket by bucketId.
   * @param synchronizer - The synchronizer account name.
   * @param bucketId - The bucket ID.
   * @returns The consensus data or null if not found.
   */
  public async getConsensusByBucketId(synchronizer: string, bucketId: number): Promise<any> {
    const rows = await this.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      index_position: IndexPosition.Primary,
      upper_bound: UInt64.from(bucketId),
      lower_bound: UInt64.from(bucketId),
      key_type: KeyType.I64,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves consensus data for a block by blockId(height + hash).
   * @param height
   * @param hash
   */
  public async getConsensusByBlockId(height: bigint, hash: string): Promise<any> {
    const blockId = computeBlockId(height, hash);
    const rows = await this.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      index_position: IndexPosition.Fifth,
      upper_bound: Checksum256.from(blockId),
      lower_bound: Checksum256.from(blockId),
      key_type: KeyType.Sha256,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the last consensus block.
   * @returns The last consensus block data or null if not found.
   */
  public async getLastConsensusBlock() {
    const rows = await this.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      limit: 1,
      reverse: true,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  public async getBlkendtConfig() {
    const rows = await this.getTableRows(ContractName.blkendt, ContractName.blkendt, 'config');
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  async switchNode() {
    if (await this.exsatNodesManager.switchNode()) {
      this.client = new APIClient(new FetchProvider(this.exsatNodesManager.getCurrentNode()));
      return true;
    }
    return false;
  }

  /**
   * Retrieves enrollment information for a given account.
   * @param account - The account name.
   * @returns The enrollment data or null if not found.
   */
  public async getEnrollmentInfo(account: string): Promise<any> {
    const rows = await this.getTableRows(ContractName.custody, ContractName.custody, 'enrollments', {
      limit: 1,
      lower_bound: Name.from(account),
      upper_bound: Name.from(account),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  public async getCustodieInfo(account: string): Promise<any> {
    const rows = await this.getTableRows(ContractName.custody, ContractName.custody, 'custodies', {
      limit: 1,
      lower_bound: Name.from(account),
      upper_bound: Name.from(account),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }
}

export default TableApi;
