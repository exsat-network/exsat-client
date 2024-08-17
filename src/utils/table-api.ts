import ExsatApi from './exsat-api';

class TableApi {
  private exsatApi: ExsatApi;

  constructor(exsatApi: ExsatApi) {
    this.exsatApi = exsatApi;
  }

  public async getLatestRewardHeight(): Promise<number> {
    const rows = await this.exsatApi.getTableRows('utxomng.xsat', 'utxomng.xsat', 'chainstate');
    if (rows && rows.length > 0) {
      // @ts-ignore
      return rows[0].irreversible_height;
    }
    return 0;
  }

  public async getEndorsementByBlockId(height: number, hash: string): Promise<any> {
    const rows =  await this.exsatApi.getTableRows('blkendt.xsat', height, 'endorsements', {
      index_position: 'secondary',
      upper_bound: hash,
      lower_bound: hash,
      key_type: 'sha256',
      limit: 1,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }
}

export default TableApi;
