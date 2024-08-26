export enum ClientType {
  Synchronizer = 1,
  Validator = 2,
}

export enum ContractName {
  poolreg = 'poolreg.xsat',
  blksync = 'blksync.xsat',
  staking = 'staking.xsat',
  endrmng = 'endrmng.xsat',
  blkendt = 'blkendt.xsat',
  rescmng = 'rescmng.xsat',
  utxomng = 'utxomng.xsat',
  rwddist = 'rwddist.xsat',
}

export const BlockStatus = {
  UPLOADING: 1,
  UPLOAD_COMPLETE: 2,
  VERIFY_MERKLE: 3,
  VERIFY_PARENT_HASH: 4,
  WAITING_MINER_VERIFICATION: 5,
  VERIFY_FAIL: 6,
  VERIFY_PASS: 7
};
