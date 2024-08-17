import fs from 'node:fs';
import process from 'process';
import * as yargs from 'yargs';
import { readFileSync } from 'fs';
import { decryptKeystore } from '@exsat/account-initializer';
import { logger } from './logger';
import { VALIDATOR_KEYSTORE_FILE, VALIDATOR_KEYSTORE_PASSWORD } from './config';

interface Arguments {
  pwd?: string;
  pwdFile?: string;
}

function getKeystorePassword() {
  const argv = yargs.options({
    pwd: { type: 'string', describe: 'Password as a command-line argument' },
    pwdFile: { type: 'string', describe: 'Path to the password file' }
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

  // Priority 2: Get the password with the command line argument --pwd
  if (!password && argv.pwd) {
    password = argv.pwd;
  }

  // Priority 3: Get passwords from environment variables
  if (!password) {
    password = VALIDATOR_KEYSTORE_PASSWORD;
  }

  // If no password is provided, output an error and exit the program
  if (!password) {
    console.error('Error: No password provided.');
    process.exit(1);
  }
  console.log('Password acquired successfully.');
  return password;
}

async function decryptKeystoreWithPassword(password: string) {
  const keystore = readFileSync(VALIDATOR_KEYSTORE_FILE, 'utf-8');
  const keystoreInfo = JSON.parse(keystore);
  const accountName = keystoreInfo.username.endsWith('.sat') ? keystoreInfo.username : `${keystoreInfo.username}.sat`;
  const privateKey = await decryptKeystore(keystore, password);
  return { accountName, privateKey };
}

export async function getAccountInfo() {
  return await decryptKeystoreWithPassword(getKeystorePassword());
}
