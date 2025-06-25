import axios from 'axios';
import { NETWORK } from './config';

export async function getUtxoBalance(address: string, network: string = NETWORK): Promise<number> {
  let balance: number = 0;
  let url: string;

  //TODO need double check the network
  if (network === 'testnet2' || network === 'testnet') {
    url = `https://mempool.space/testnet/api/address/${address}`;
  } else if (network === 'mainnet' || !network) {
    url = `https://mempool.space/api/address/${address}`;
  } else {
    url = `https://mempool.space/${network}/api/address/${address}`;
  }

  const response = await axios.get(url);
  if (response.status === 200) {
    balance = Number(response.data.chain_stats.funded_txo_sum) - Number(response.data.chain_stats.spent_txo_sum);
  }

  return balance;
}

export async function getTransaction(txid: string, network: string = NETWORK) {
  if (network === 'testnet2')
    network='testnet';
  let url = `https://mempool.space/${network}/api/tx/${txid}`;
  if (network === 'mainnet') {
    url = `https://mempool.space/api/tx/${txid}`;
  }
  const response = await axios.get(url);

  if (response.status === 200) {
    return response.data;
  }
  return null;
}
