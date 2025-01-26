import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import HDKey from 'hdkey';
import { PrivateKey } from '@wharfkit/antelope';
import { writeFileSync } from 'fs';
import WIF from 'wif';
import { bytesToHex } from 'web3-utils';
import { confirm, input, password, select } from '@inquirer/prompts';
import {
  capitalizeFirstLetter,
  clearLines,
  inputWithCancel,
  processAndUpdatePassword,
  selectDirPrompt,
} from '../utils/input';
import { isExsatDocker, retry, updateEnvFile } from '../utils/common';
import { Font } from '../utils/font';
import { createKeystore, keystoreExist } from '../utils/keystore';
import axios from 'axios';
import { logger } from '../utils/logger';
import { EXSAT_RPC_URLS } from '../utils/config';

function validateUsername(username) {
  return /^[a-z1-5]{1,8}$/.test(username);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function checkUserAccountExist(accountName) {
  return await retry(async () => {
    try {
      await axios.post(
        `${EXSAT_RPC_URLS[0]}/v1/chain/get_account`,
        JSON.stringify({
          account_name: accountName,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return true;
    } catch (error: any) {
      if (error.response && error.response.data.message === 'Account lookup') {
        return false;
      }
      throw error;
    }
  });
}
async function getInputRole() {
  const role = await select({
    message: 'Select a role',
    choices: [
      { name: 'Synchronizer', value: 'Synchronizer' },
      { name: 'Validator', value: 'Validator' },
    ],
  });
  return role;
}

async function saveKeystore(privateKey, username, role) {
  const getPasswordInput = async (message) => {
    return await password({
      message,
      mask: '*',
      validate: (input) => input.length >= 6 || 'Password must be at least 6 characters.',
    });
  };

  let passwordInput = await getPasswordInput('Set a password to encrypt the private key (at least 6 characters): ');
  let passwordConfirmInput = await getPasswordInput('Confirm your password: ');

  while (passwordInput !== passwordConfirmInput) {
    console.log(`\n${Font.fgYellow}${Font.bright}'Passwords not match, please try again.'${Font.reset}\n`);
    passwordInput = await getPasswordInput('Enter a password to encrypt your private key (at least 6 characters): ');
    passwordConfirmInput = await getPasswordInput('Confirm your password: ');
  }

  // Continue with the rest of the keystore saving logic
  const keystore = await createKeystore(
    `${bytesToHex(WIF.decode(privateKey.toWif(), 128).privateKey)}`,
    passwordInput,
    username
  );
  const savePassword = await confirm({
    message: 'Do you want to save the password in the .env file?',
  });
  console.log(`\n${Font.fgCyan}${Font.bright}Keystore created successfully.${Font.reset}\n`);

  let selectedPath;
  let pathConfirm = 'yes';
  do {
    selectedPath = await selectDirPrompt();
    if (isExsatDocker()) {
      pathConfirm = await input({
        message: `Please ensure that the save path you set ( ${selectedPath} ) matches the Docker mapping path. Otherwise, your keystore file may be lost. ( Enter "yes" to continue, or "no" to go back to the previous step ):`,
        validate: (input) => ['yes', 'no'].includes(input.toLowerCase()) || 'Please input "yes" or "no".',
      });
    }
  } while (pathConfirm.toLowerCase() === 'no');

  const keystoreFilePath = `${selectedPath}/${username}_keystore.json`;
  writeFileSync(keystoreFilePath, JSON.stringify(keystore), { mode: 0o600 });

  const keystoreFileKey = `${role.toUpperCase()}_KEYSTORE_FILE`;
  const updateDatas = {
    [keystoreFileKey]: keystoreFilePath,
    [`${role.toUpperCase()}_KEYSTORE_PASSWORD`]: savePassword ? processAndUpdatePassword(passwordInput) : '',
  };
  updateEnvFile(updateDatas);

  console.log(`\n${Font.colorize('!!!Remember to backup this file!!!', Font.fgRed)}`);
  console.log(`${Font.colorize(`Saved successfully: ${keystoreFilePath}`, Font.fgGreen)}\n`);
  return keystoreFilePath;
}

async function generateKeystore(username, role) {
  const mnemonic = generateMnemonic(wordlist);
  console.log(`${Font.colorize(`\nYour seed phrase: \n${mnemonic}`, Font.fgYellow)}\n`);
  await input({
    message:
      "Please confirm that you have backed up and saved the seed phrase (Input 'yes' after you have saved the seed phrase, and then the seed phrase will be hidden.):",
    validate: (input) => input.toLowerCase() === 'yes' || 'Please input “yes” to continue.',
  });
  clearLines(5);

  const seed = mnemonicToSeedSync(mnemonic);
  const master = HDKey.fromMasterSeed(Buffer.from(seed));
  const node = master.derive("m/44'/194'/0'/0/0");

  const privateKey = PrivateKey.from(WIF.encode(128, node.privateKey!, false).toString());
  const publicKey = privateKey.toPublic().toString();

  console.log(`\n${Font.fgCyan}${Font.bright}Key pair generation successful.${Font.reset}\n`);
  await saveKeystore(privateKey, username, role);

  return { privateKey, publicKey, username };
}

async function importAccountAndSaveKeystore(privateKey) {
  return await retry(async () => {
    const accountName = await input({
      message: 'Enter your account name (1-8 characters): ',
    });
    const fullAccountName = accountName.endsWith('.sat') ? accountName : `${accountName}.sat`;
    const accountInfo: any = await checkUserAccountExist(fullAccountName);
    if (privateKey.toPublic().toString() === accountInfo.pubkey) {
      return { accountName, ...accountInfo };
    }
    throw new Error('Account name is not matched.');
  }, 3);
}

async function inputMnemonic() {
  const mnemonic = await inputWithCancel('Enter your seed phrase (12 words, Input "q" to return): ');
  if (!mnemonic) return false;
  const seed = mnemonicToSeedSync(mnemonic.trim());
  const master = HDKey.fromMasterSeed(Buffer.from(seed));
  const node = master.derive("m/44'/194'/0'/0/0");

  const privateKey = PrivateKey.from(WIF.encode(128, node.privateKey!, false).toString());
  clearLines(2);
  return privateKey;
}

export async function importFromMnemonic(role) {
  if (!role) {
    role = await getInputRole();
  }
  let accountInfo;
  let privateKey;
  try {
    privateKey = await inputMnemonic();
    if (!privateKey) return false;
    console.log(`${Font.fgCyan}${Font.bright}keystore generation successful.${Font.reset}\n`);
    accountInfo = await importAccountAndSaveKeystore(privateKey);
  } catch (error: any) {
    console.log(`${Font.fgYellow}${Font.bright}Seed Phrase not available${Font.reset}`);
    return false;
  }
  await saveKeystore(privateKey, accountInfo.accountName, role);
  return await processAccount(accountInfo);
}

export async function importFromPrivateKey(role) {
  if (!role) {
    role = await getInputRole();
  }
  let account;
  let privateKey;
  try {
    const success = await retry(async () => {
      const privateKeyInput = await inputWithCancel('Enter your private key (64 characters, Input "q" to return): ');
      if (!privateKeyInput) return false;
      privateKey = PrivateKey.from(privateKeyInput);
      console.log(`${Font.fgCyan}${Font.bright}keystore generation successful.${Font.reset}\n`);
      account = await importAccountAndSaveKeystore(privateKey);
      return true;
    }, 3);
    if (!success) return false;
  } catch (e) {
    console.log(`${Font.fgYellow}${Font.bright}Private key not available${Font.fgYellow}`);
    return;
  }
  await saveKeystore(privateKey, account.accountName, role);
  return await processAccount(account);
}

export async function processAccount({ accountName, pubkey, status, btcAddress, amount }) {
  //todo processAccount
}

export async function initializeAccount(role) {
  role = capitalizeFirstLetter(role);
  const keystoreFile = keystoreExist(role);
  if (keystoreFile) {
    console.log(`\n${Font.fgYellow}${Font.bright}An account has already been created in ${keystoreFile}.${Font.reset}`);
    return;
  }
  let registryStatus;
  const username = await input({
    message: 'Enter an account name (1-8 characters, a-z, 1-5. Input "q" to return): ',
    validate: async (input) => {
      if (input === 'q') return true;
      if (!validateUsername(input)) {
        return 'Please enter an account name that is 1-8 characters long, contains only a-z and 1-5.';
      }
      try {
        const response: any = await checkUserAccountExist(input);
        registryStatus = response.status;
        switch (registryStatus) {
          case 'valid':
            return true;
          case 'chain_off':
            return 'The network query failed. Please try again later or contact the administrator.';
          default:
            return 'This username is already registered. Please enter another one.';
        }
      } catch (error: any) {
        return `Request error: ${error.message}`;
      }
    },
  });
  if (username === 'q') return false;
  console.log(Font.colorize(`  Your account : ${username}.sat`, Font.fgGreen));

  if (!role) {
    role = await getInputRole();
  }
  let rewardAddress = '';
  let commissionRate = '';
  if (role === 'Validator') {
    commissionRate = await input({
      message: 'Enter commission ratio (0.00-100.00): ',
      validate: (input) => {
        const num = parseFloat(input);
        // Check if it is a valid number and within the range
        if (!isNaN(num) && num >= 0 && num <= 100 && /^\d+(\.\d{1,2})?$/.test(input)) {
          return true;
        }
        return 'Please enter a valid number between 0.00 and 100.00';
      },
    });

    rewardAddress = await input({
      message: 'Enter reward address',
      validate: (input) => /^0x[a-fA-F0-9]{40}$/.test(input) || 'Please enter a valid reward address.',
    });
  }
  const { publicKey } = await generateKeystore(username, role);
  const infoJson = '{}';
  try {
    //todo notice a url
    return username;
  } catch (error: any) {
    console.error('Error creating account: ', error.message);
  }
}
