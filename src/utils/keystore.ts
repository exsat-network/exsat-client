import fs from 'node:fs';
import process from 'process';
import * as yargs from 'yargs';
import { readFileSync } from 'fs';
import { decryptKeystore } from '@exsat/account-initializer';
import { logger } from './logger';
import path from 'node:path';
import dotenv from 'dotenv';
import { ClientType } from './enumeration';
import { SYNCHRONIZER_KEYSTORE_PASSWORD, VALIDATOR_KEYSTORE_PASSWORD } from './config';
import { password } from "@inquirer/prompts";

interface Arguments {
  pwd?: string;
  pwdFile?: string;
}

export function getConfigPassword(clientType: number) {
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
    password = (clientType === ClientType.Synchronizer ? SYNCHRONIZER_KEYSTORE_PASSWORD : VALIDATOR_KEYSTORE_PASSWORD);
  }
  return password;
}

export async function getInputPassword(): Promise<string> {
  const passwordInput = await password({ message: 'Please enter your keystore password (Enter q to exit): ' });
  return passwordInput.trim();
}

export async function getAccountInfo(keystoreFile: string, password: string) {
  const keystore = readFileSync(keystoreFile, 'utf-8');
  const keystoreInfo = JSON.parse(keystore);
  const accountName = keystoreInfo.username.endsWith('.sat') ? keystoreInfo.username : `${keystoreInfo.username}.sat`;
  const privateKey = await decryptKeystore(keystore, password);
  return { accountName, privateKey, publicKey: keystoreInfo.address };
}

export function reloadEnv() {
  const envFilePath = path.resolve(__dirname, '../../', '.env');
  if (!fs.existsSync(envFilePath)) {
    throw new Error('No .env file found');
  }
  dotenv.config({ override: true, path: envFilePath });
}

export function existKeystore(): boolean {
  reloadEnv();
  const file = process.env.KEYSTORE_FILE;
  if (file && fs.existsSync(file)) {
    return true;
  }
  const dir = path.resolve(__dirname);
  const files = fs.readdirSync(dir);
  for (let i = 0; i < files.length; i++) {
    if (files[i].endsWith('_keystore.json')) return true;
  }

  return false;
}
