import axios from 'axios';

async function sendBtcRpcRequest(data: object): Promise<any> {
  let rpcAuth = '';
  if (process.env.BTC_RPC_USERNAME && process.env.BTC_RPC_PASSWORD) {
    rpcAuth = Buffer.from(`${process.env.BTC_RPC_USERNAME}:${process.env.BTC_RPC_PASSWORD}`,).toString('base64');
  }
  const headers = {
    'Content-Type': 'text/plain',
    'Authorization': rpcAuth ? `Basic ${rpcAuth}` : ''
  };
  const response = await axios.post(process.env.BTC_RPC_URL, data, { headers });
  return response.data;
}

export async function getblockhash(blockNumber: number): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblockhash',
    params: [blockNumber]
  };
  return sendBtcRpcRequest(data);
}

export async function getblockcount(): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblockcount',
    params: []
  };
  return sendBtcRpcRequest(data);
}

export async function getLatestBlockInfo() {
  const blockcountRes = await getblockcount();
  const blockhashRes = await getblockhash(blockcountRes.result);
  return {
    height: blockcountRes.result,
    hash: blockhashRes.result
  };
}

export async function getblockheader(blockhash: string): Promise<any> {
  const data = {
    jsonrpc: '1.0',
    id: Date.now(),
    method: 'getblockheader',
    params: [blockhash]
  };
  return sendBtcRpcRequest(data);
}
