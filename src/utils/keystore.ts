import fs from 'node:fs';
import process from 'process';
import * as yargs from 'yargs';
import { readFileSync } from 'fs';
import { logger } from './logger';
import path from 'node:path';
import { ClientType } from './enumeration';
import { password } from '@inquirer/prompts';
import { reloadEnv } from './common';
import { PrivateKey } from '@wharfkit/antelope';
import { decrypt as createDecipheriv, encrypt as createCipheriv } from 'ethereum-cryptography/aes.js';
import WIF from 'wif';
import { pbkdf2Sync } from 'ethereum-cryptography/pbkdf2.js';
import { scryptSync } from 'ethereum-cryptography/scrypt.js';
import {
  InvalidKdfError,
  InvalidPasswordError,
  InvalidPrivateKeyError,
  IVLengthError,
  KeyDerivationError,
  KeyStoreVersionError,
  PBKDF2IterationsError,
  PrivateKeyLengthError,
} from 'web3-errors';
import { Bytes, CipherOptions, KeyStore, PBKDF2SHA256Params, ScryptParams } from 'web3-types';
import {
  bytesToUint8Array,
  bytesToHex,
  hexToBytes,
  isUint8Array,
  randomBytes,
  sha3Raw,
  uint8ArrayConcat,
  utf8ToHex,
  uuidV4,
} from 'web3-utils';

import { isHexStrict, isString, validator } from 'web3-validator';

const keyStoreSchema = {
  type: 'object',
  required: ['crypto', 'id', 'version', 'address'],
  properties: {
    crypto: {
      type: 'object',
      required: ['cipher', 'ciphertext', 'cipherparams', 'kdf', 'kdfparams', 'mac'],
      properties: {
        cipher: { type: 'string' },
        ciphertext: { type: 'string' },
        cipherparams: { type: 'object' },
        kdf: { type: 'string' },
        kdfparams: { type: 'object' },
        salt: { type: 'string' },
        mac: { type: 'string' },
      },
    },
    id: { type: 'string' },
    version: { type: 'number' },
    address: { type: 'string' },
    username: { type: 'string' },
  },
};

interface Arguments {
  pwdFile?: string;
}

export function getConfigPassword(clientType: number) {
  const argv = yargs.options({
    pwdFile: { type: 'string', describe: 'Path to the password file' },
  }).argv as Arguments;

  let password: string | undefined;

  // Priority 1: Read the password from the file with the command line argument --pwdFile
  if (argv.pwdFile) {
    try {
      password = fs.readFileSync(argv.pwdFile, 'utf8').trim();
    } catch (error) {
      logger.error('Error: Unable to read password from file:', (error as Error).message);
      process.exit(1);
    }
  }

  // Priority 2: Get passwords from environment variables
  if (!password) {
    switch (clientType) {
      case ClientType.Validator:
        password = process.env.VALIDATOR_KEYSTORE_PASSWORD;
        break;
      case ClientType.Synchronizer:
        password = process.env.SYNCHRONIZER_KEYSTORE_PASSWORD;
        break;
      default:
        throw new Error('Invalid client type');
    }
  }
  return password.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

export async function getInputPassword(): Promise<string> {
  const passwordInput = await password({
    message: 'Please enter your keystore password (Enter q to exit): ',
    mask: '*',
  });
  return passwordInput.trim();
}

export async function getAccountInfo(keystoreFile: string, password: string) {
  const keystore = readFileSync(keystoreFile, 'utf-8');
  const keystoreInfo = JSON.parse(keystore);
  const accountName = keystoreInfo.username.endsWith('.sat') ? keystoreInfo.username : `${keystoreInfo.username}.sat`;
  const privateKey = await decryptKeystore(keystore, password);
  return { accountName, privateKey, publicKey: keystoreInfo.address };
}
export async function getBaseAccountInfo(keystoreFile) {
  const keystore = readFileSync(keystoreFile, 'utf-8');
  const keystoreInfo = JSON.parse(keystore);
  const accountName = keystoreInfo.username.endsWith('.sat') ? keystoreInfo.username : `${keystoreInfo.username}.sat`;
  return { accountName, publicKey: keystoreInfo.address };
}
export function keystoreExist(role?: string) {
  if (role) {
    const keystoreFileKey = `${role.toUpperCase()}_KEYSTORE_FILE`;
    if (process.env[keystoreFileKey] && fs.existsSync(process.env[keystoreFileKey] ?? '')) {
      return process.env[keystoreFileKey];
    }
  }
  const dir = path.resolve(__dirname, '..');
  const files = fs.readdirSync(dir);
  for (let i = 0; i < files.length; i++) {
    if (files[i].endsWith('_keystore.json')) return files[i];
  }
  return false;
}

export function keystoreExistStatus() {
  let s = 0;
  if (process.env.SYNCHRONIZER_KEYSTORE_FILE) {
    s = s + 1;
  }
  if (process.env.VALIDATOR_KEYSTORE_FILE) {
    s = s + 2;
  }
  return s;
}

/**
 * Get the private key Uint8Array after the validation.
 * Note: This function is not exported through main web3 package, so for using it directly import from accounts package.
 * @param data - Private key
 * @param ignoreLength - Optional, ignore length check during validation
 * @returns The Uint8Array private key
 *
 * ```ts
 * parseAndValidatePrivateKey("0x08c673022000ece7964ea4db2d9369c50442b2869cbd8fc21baaca59e18f642c")
 *
 * > Uint8Array(32) [
 * 186,  26, 143, 168, 235, 179,  90,  75,
 * 101,  63,  84, 221, 152, 150,  30, 203,
 *   8, 113,  94, 226,  53, 213, 216,   5,
 * 194, 159,  17,  53, 219,  97, 121, 248
 * ]
 *
 * ```
 */
export const parseAndValidatePrivateKey = (data: Bytes, ignoreLength?: boolean): Uint8Array => {
  let privateKeyUint8Array: Uint8Array;
  // To avoid the case of 1 character less in a hex string which is prefixed with '0' by using 'bytesToUint8Array'
  if (!ignoreLength && typeof data === 'string' && isHexStrict(data) && data.length !== 66) {
    throw new PrivateKeyLengthError();
  }

  try {
    privateKeyUint8Array = isUint8Array(data) ? data : bytesToUint8Array(data);
  } catch {
    throw new InvalidPrivateKeyError();
  }

  if (!ignoreLength && privateKeyUint8Array.byteLength !== 32) {
    throw new PrivateKeyLengthError();
  }

  return privateKeyUint8Array;
};

export const createKeystore = async (
  privateKey: Bytes,
  password: string,
  username: string,
  options?: CipherOptions
): Promise<any> => {
  const privateKeyUint8Array = parseAndValidatePrivateKey(privateKey);
  const privekeyByte = hexToBytes(`${privateKey}`);
  // if given salt or iv is a string, convert it to a Uint8Array
  let salt;
  if (options?.salt) {
    salt = typeof options.salt === 'string' ? hexToBytes(options.salt) : options.salt;
  } else {
    salt = randomBytes(32);
  }

  if (!(isString(password) || isUint8Array(password))) {
    throw new InvalidPasswordError();
  }

  const uint8ArrayPassword = typeof password === 'string' ? hexToBytes(utf8ToHex(password)) : password;

  let initializationVector;
  if (options?.iv) {
    initializationVector = typeof options.iv === 'string' ? hexToBytes(options.iv) : options.iv;
    if (initializationVector.length !== 16) {
      throw new IVLengthError();
    }
  } else {
    initializationVector = randomBytes(16);
  }

  const kdf = options?.kdf ?? 'scrypt';

  let derivedKey;
  let kdfparams: ScryptParams | PBKDF2SHA256Params;

  // derive key from key derivation function
  if (kdf === 'pbkdf2') {
    kdfparams = {
      dklen: options?.dklen ?? 32,
      salt: bytesToHex(salt).replace('0x', ''),
      c: options?.c ?? 600000,
      prf: 'hmac-sha256',
    };

    if (kdfparams.c < 100000) {
      // error when c < 1000, pbkdf2 is less secure with less iterations
      throw new PBKDF2IterationsError();
    }
    derivedKey = pbkdf2Sync(uint8ArrayPassword, salt, kdfparams.c, kdfparams.dklen, 'sha256');
  } else if (kdf === 'scrypt') {
    kdfparams = {
      n: options?.n ?? 8192,
      r: options?.r ?? 8,
      p: options?.p ?? 1,
      dklen: options?.dklen ?? 32,
      salt: bytesToHex(salt).replace('0x', ''),
    };
    derivedKey = scryptSync(uint8ArrayPassword, salt, kdfparams.n, kdfparams.p, kdfparams.r, kdfparams.dklen);
  } else {
    throw new InvalidKdfError();
  }

  const cipher = await createCipheriv(
    privateKeyUint8Array,
    derivedKey.slice(0, 16),
    initializationVector,
    'aes-128-ctr'
  );

  const ciphertext = bytesToHex(cipher).slice(2);

  const pvKeyFromWif = PrivateKey.from(WIF.encode(128, Buffer.from(privekeyByte), false).toString());

  const publicKey = pvKeyFromWif.toPublic().toString();

  const mac = sha3Raw(uint8ArrayConcat(derivedKey.slice(16, 32), cipher)).replace('0x', '');
  return {
    version: 3,
    id: uuidV4(),
    address: publicKey,
    username,
    crypto: {
      ciphertext,
      cipherparams: {
        iv: bytesToHex(initializationVector).replace('0x', ''),
      },
      cipher: 'aes-128-ctr',
      kdf,
      kdfparams,
      mac,
    },
  };
};

export const decryptKeystore = async (
  keystore: KeyStore | string,
  password: string | Uint8Array,
  nonStrict?: boolean
): Promise<string> => {
  const json =
    typeof keystore === 'object' ? keystore : (JSON.parse(nonStrict ? keystore.toLowerCase() : keystore) as KeyStore);

  validator.validateJSONSchema(keyStoreSchema, json);

  if (json.version !== 3) throw new KeyStoreVersionError();

  const uint8ArrayPassword = typeof password === 'string' ? hexToBytes(utf8ToHex(password)) : password;

  validator.validate(['bytes'], [uint8ArrayPassword]);

  let derivedKey;
  if (json.crypto.kdf === 'scrypt') {
    const kdfparams = json.crypto.kdfparams as ScryptParams;
    const uint8ArraySalt = typeof kdfparams.salt === 'string' ? hexToBytes(kdfparams.salt) : kdfparams.salt;
    derivedKey = scryptSync(uint8ArrayPassword, uint8ArraySalt, kdfparams.n, kdfparams.p, kdfparams.r, kdfparams.dklen);
  } else if (json.crypto.kdf === 'pbkdf2') {
    const kdfparams: PBKDF2SHA256Params = json.crypto.kdfparams as PBKDF2SHA256Params;

    const uint8ArraySalt = typeof kdfparams.salt === 'string' ? hexToBytes(kdfparams.salt) : kdfparams.salt;

    derivedKey = pbkdf2Sync(uint8ArrayPassword, uint8ArraySalt, kdfparams.c, kdfparams.dklen, 'sha256');
  } else {
    throw new InvalidKdfError();
  }

  const ciphertext = hexToBytes(json.crypto.ciphertext);
  const mac = sha3Raw(uint8ArrayConcat(derivedKey.slice(16, 32), ciphertext)).replace('0x', '');

  if (mac !== json.crypto.mac) {
    throw new KeyDerivationError();
  }

  const seed = await createDecipheriv(
    hexToBytes(json.crypto.ciphertext),
    derivedKey.slice(0, 16),
    hexToBytes(json.crypto.cipherparams.iv)
  );

  const pvKeyFromWif = PrivateKey.from(WIF.encode(128, Buffer.from(seed), false).toString());
  return pvKeyFromWif.toString();
};
