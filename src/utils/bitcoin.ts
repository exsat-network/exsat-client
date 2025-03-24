import axios from 'axios';
import { BTC_RPC_PASSWORD, BTC_RPC_TIMEOUT, BTC_RPC_URL, BTC_RPC_USERNAME, CHUNK_SIZE } from './config';

/**
 * sendBtcRpcRequest
 * @param data
 */
async function sendBtcRpcRequest(data: object): Promise<any> {
  try {
    let rpcAuth = '';
    if (BTC_RPC_USERNAME && BTC_RPC_PASSWORD) {
      rpcAuth = Buffer.from(`${BTC_RPC_USERNAME}:${BTC_RPC_PASSWORD}`).toString('base64');
    }
    const headers = {
      'Content-Type': 'text/plain',
      Authorization: rpcAuth ? `Basic ${rpcAuth}` : '',
    };
    const response = await axios.post(BTC_RPC_URL, data, { headers, timeout: BTC_RPC_TIMEOUT });
    return response.data;
  } catch (e: any) {
    throw new Error(
      `Send BTC RPC request error, rpcUrl: ${BTC_RPC_URL}, data: ${JSON.stringify(data)}, error: ${e.message}`
    );
  }
}

/**
 * getblockhash
 * @param blockNumber
 * @returns
 * {
 *     "result": "0000000000000000000320283a032748cef8227873ff4872689bf23f1cda83a5",
 *     "error": null,
 *     "id": 1
 * }
 */
export async function getblockhash(blockNumber: number): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblockhash',
    params: [blockNumber],
  };
  return sendBtcRpcRequest(data);
}

/**
 * getblockcount
 * @returns
 * {
 *     "result": 840000,
 *     "error": null,
 *     "id": 1
 * }
 */
export async function getblockcount(): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblockcount',
    params: [],
  };
  return sendBtcRpcRequest(data);
}

/**
 * getLatestBlockInfo
 * @returns
 * {
 *    "height": 840000,
 *    "hash": "0000000000000000000320283a032748cef8227873ff4872689bf23f1cda83a5"
 * }
 */
export async function getLatestBlockInfo() {
  const blockcountRes = await getblockcount();
  const blockhashRes = await getblockhash(blockcountRes.result);
  return {
    height: blockcountRes.result,
    hash: blockhashRes.result,
  };
}

/**
 * getblockheader
 * @param blockhash
 * @returns
 * {
 *     "result": {
 *         "hash": "0000000000000000000320283a032748cef8227873ff4872689bf23f1cda83a5",
 *         "confirmations": 17645,
 *         "height": 840000,
 *         "version": 710926336,
 *         "versionHex": "2a5fe000",
 *         "merkleroot": "031b417c3a1828ddf3d6527fc210daafcc9218e81f98257f88d4d43bd7a5894f",
 *         "time": 1713571767,
 *         "mediantime": 1713570208,
 *         "nonce": 3932395645,
 *         "bits": "17034219",
 *         "difficulty": 86388558925171.02,
 *         "chainwork": "0000000000000000000000000000000000000000753bdab0e0d745453677442b",
 *         "nTx": 3050,
 *         "previousblockhash": "0000000000000000000172014ba58d66455762add0512355ad651207918494ab",
 *         "nextblockhash": "00000000000000000001b48a75d5a3077913f3f441eb7e08c13c43f768db2463"
 *     },
 *     "error": null,
 *     "id": 1
 * }
 */
export async function getblockheader(blockhash: string): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblockheader',
    params: [blockhash],
  };
  return sendBtcRpcRequest(data);
}

/**
 * getblockraw
 * @param blockhash
 * @returns
 * {
 *     "result": "04000028912583914aa147b432...",
 *     "error": null,
 *     "id": 1
 * }
 */
export async function getblock(blockhash: string): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblock',
    params: [blockhash, 0],
  };
  return sendBtcRpcRequest(data);
}

/**
 * Splits a raw block of data into chunks and maps each chunk to an ID.
 *
 * @param blockRaw - The raw data of the block to be split.
 * @returns A map where the keys are chunk IDs (starting from 0) and the values are the corresponding chunks of the block.
 */
export function getChunkMap(blockRaw): Map<number, string> {
  const chunkMap: Map<number, string> = new Map();
  let chunkId: number = 0;
  for (let i = 0; i < blockRaw.length; i += CHUNK_SIZE) {
    const chunk = blockRaw.slice(i, i + CHUNK_SIZE);
    chunkMap.set(chunkId++, chunk);
  }
  return chunkMap;
}
