import ExsatApi from './exsat-api';
import { ContractName, IndexPosition, KeyType } from './enumeration';
import { computeBlockId } from './key';

class TableApi {
  private exsatApi: ExsatApi;

  /**
   * Initializes TableApi with an ExsatApi instance.
   * @param exsatApi - The ExsatApi instance to use for API calls.
   */
  constructor(exsatApi: ExsatApi) {
    this.exsatApi = exsatApi;
  }

  /**
   * Checks if the exSat network has started.
   * @returns A boolean indicating the startup status.
   */
  public async getStartupStatus() {
    const rows: any = await this.exsatApi.getTableRows(ContractName.blkendt, ContractName.blkendt, 'config');
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
    const rows = await this.exsatApi.getTableRows(ContractName.blkendt, height, 'endorsements', {
      index_position: IndexPosition.Secondary,
      upper_bound: hash,
      lower_bound: hash,
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
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'chainstate');
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  public async getSynchronizerInfo(synchronizer: string): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.poolreg, ContractName.poolreg, 'synchronizer', {
      limit: 1,
      lower_bound: synchronizer,
      upper_bound: synchronizer,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves a block bucket by its ID.
   * @param synchronizer - The synchronizer account name.
   * @param bucketId - The bucket ID.
   * @returns The block bucket data or null if not found.
   */
  public async getBlockbucketById(synchronizer: string, bucketId: number): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.blksync, synchronizer, 'blockbuckets', {
      index_position: IndexPosition.Primary,
      upper_bound: bucketId,
      lower_bound: bucketId,
      key_type: KeyType.I64,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves all block buckets for a given synchronizer.
   * @param synchronizer - The synchronizer account name.
   * @returns An array of block buckets.
   */
  public async getAllBlockbucket(synchronizer: string): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.blksync, synchronizer, 'blockbuckets', {
      fetch_all: true,
    });
    return rows;
  }


  public async getBlockbuckets(synchronizer: string, status: number): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.blkendt, synchronizer, 'blockbuckets', {
      index_position: IndexPosition.Secondary,
      upper_bound: status,
      lower_bound: status,
      key_type: KeyType.I64,
    });
    return rows;
  }

  /**
   * Retrieves consensus data for a block bucket by its ID.
   * @param synchronizer - The synchronizer account name.
   * @param bucketId - The bucket ID.
   * @returns The consensus data or null if not found.
   */
  public async getConsensusByBucketId(synchronizer: string, bucketId: number): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      index_position: IndexPosition.Primary,
      upper_bound: bucketId,
      lower_bound: bucketId,
      key_type: KeyType.I64,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  public async getConsensusByBlockId(synchronizer: string, height: bigint, hash: string): Promise<any> {
    const blockId = computeBlockId(height, hash);
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      index_position: IndexPosition.Tertiary,
      upper_bound: blockId,
      lower_bound: blockId,
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
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      limit: 1,
      reverse: true
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }
}

export default TableApi;
