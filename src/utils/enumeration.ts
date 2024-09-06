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
  res = 'res.xsat',
}

export enum BlockStatus {
  UPLOADING = 1,
  UPLOAD_COMPLETE = 2,
  VERIFY_MERKLE = 3,
  VERIFY_PARENT_HASH = 4,
  WAITING_MINER_VERIFICATION = 5,
  VERIFY_FAIL = 6,
  VERIFY_PASS = 7
}

export enum IndexPosition {
  Primary = 'primary',
  Secondary = 'secondary',
  Tertiary = 'tertiary',
  Fourth = 'fourth',
  Fifth = 'fifth',
  Sixth = 'sixth',
  Seventh = 'seventh',
  Eighth = 'eighth',
  Ninth = 'ninth',
  Tenth = 'tenth'
}

export enum KeyType {
  I64 = 'i64',
  I128 = 'i128',
  I256 = 'i256',
  Float64 = 'float64',
  Float128 = 'float128',
  Ripemd160 = 'ripemd160',
  Sha256 = 'sha256',
  Name = 'name',
}

export enum ErrorCode {
  Code1001 = '1001', //1001:blkendt.xsat::endorse: the current endorsement status is disabled
  Code1002 = '1002', //1002:blkendt.xsat::endorse: the block has been parsed and does not need to be endorsed
  Code1003 = '1003', //1003:blkendt.xsat::endorse: the endorsement height cannot exceed height
  Code2005 = '2005', //2005:blksync.xsat::initbucket: the block has reached consensus
  Code2008 = '2008', //2008:blksync.xsat::initbucket: cannot init bucket in the current state [verify_pass]
  Code2013 = '2013', //2013:blksync.xsat::pushchunk: cannot push chunk in the current state [verify_merkle]
  Code2017 = '2017', //2017:blksync.xsat::delbucket: [blockbuckets] does not exists
  Code2018 = '2018', //2018:blksync.xsat::verify: you have not uploaded the block data. please upload it first and then verify it
  Code2020 = '2020', //2020:blksync.xsat::verify: parent block hash did not reach consensus
  Code2022 = '2022', //2022:blksync.xsat::verify: waiting for miners to produce blocks
}
