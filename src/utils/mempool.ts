import axios from 'axios';
import { NETWORK } from './config';

export async function getUtxoBalance(address: string, network: string = NETWORK): Promise<number> {
  let balance: number = 0;
  if (network === 'testnet2') network = 'testnet';
  let url = `https://mempool.space/${network}/api/address/${address}`;
  if (network === 'mainnet' || !network) {
    url = `https://mempool.space/api/address/${address}`;
  }

  try {
    const response = await axios.get(url);
    if (response.status === 200) {
      balance = Number(response.data.chain_stats.funded_txo_sum) - Number(response.data.chain_stats.spent_txo_sum);
    }
  } catch (e: any) {}
  return balance;
}

export async function getTransaction(txid: string, network: string = NETWORK) {
  if (network === 'testnet2') network = 'testnet';
  let url = `https://mempool.space/${network}/api/tx/${txid}`;
  if (network === 'mainnet') {
    url = `https://mempool.space/api/tx/${txid}`;
  }
  try {
    const response = await axios.get(url);
    if (response.status === 200) {
      return response.data;
    }
  } catch (e: any) {}
  return null;
}
