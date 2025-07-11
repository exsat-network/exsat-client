import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import HDKey from 'hdkey';
import { PrivateKey } from '@wharfkit/antelope';
import { writeFileSync } from 'fs';
import WIF from 'wif';
import { bytesToHex } from 'web3-utils';
import { confirm, input, password, select } from '@inquirer/prompts';
import { clearLines, inputWithCancel, processAndUpdatePassword, selectDirPrompt } from '../utils/input';
import { normalizeAccountName, retry, updateEnvFile } from '../utils/common';
import { Font } from '../utils/font';
import { createKeystore, keystoreExist } from '../utils/keystore';
import { IS_DOCKER, EXSAT_RPC_URLS } from '../utils/config';
import { Client } from '../utils/enumeration';
import TableApi from '../utils/table-api';
import { http } from '../utils/http';

function validateUsername(username) {
  return /^[a-z1-5.]{1,8}$/.test(username);
}

export async function getUserAccount(accountName) {
  try {
    const response = await http.post(
      `${EXSAT_RPC_URLS[0]}/v1/chain/get_account`,
      JSON.stringify({
        account_name: normalizeAccountName(accountName),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const owner = response.data.permissions.find((p) => p.perm_name === 'owner');
    return { account: response.data.account_name, pubkey: owner.required_auth.keys[0].key };
  } catch (error: any) {
    if (error.response && error.response.data.message === 'Account lookup') {
      return false;
    }
    throw error;
  }
}

export async function getInputRole(title?) {
  title = title ?? 'Select a role';
  return await select({
    message: title,
    choices: [
      { name: 'Synchronizer', value: Client.Synchronizer },
      { name: 'Validator', value: Client.Validator },
    ],
  });
}

async function saveKeystore(privateKey, username, role?) {
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
    if (IS_DOCKER) {
      pathConfirm = await input({
        message: `Please ensure that the save path you set ( ${selectedPath} ) matches the Docker mapping path. Otherwise, your keystore file may be lost. ( Enter "yes" to continue, or "no" to go back to the previous step ):`,
        validate: (input) => ['yes', 'no'].includes(input.toLowerCase()) || 'Please input "yes" or "no".',
      });
    }
  } while (pathConfirm.toLowerCase() === 'no');

  const keystoreFilePath = `${selectedPath}/${username}_keystore.json`;
  writeFileSync(keystoreFilePath, JSON.stringify(keystore), { mode: 0o600 });
  let updateDatas;
  if (role) {
    const keystoreFileKey = `${role.toUpperCase()}_KEYSTORE`;
    updateDatas = {
      [`${keystoreFileKey}_FILE`]: keystoreFilePath,
      [`${keystoreFileKey}_PASSWORD`]: savePassword ? processAndUpdatePassword(passwordInput) : '',
    };
  } else {
    const syncKeystoreFileKey = `${Client.Synchronizer.toUpperCase()}_KEYSTORE`;
    const valiKeystoreFileKey = `${Client.Validator.toUpperCase()}_KEYSTORE`;

    updateDatas = {
      [`${syncKeystoreFileKey}_FILE`]: keystoreFilePath,
      [`${syncKeystoreFileKey}_PASSWORD`]: savePassword ? processAndUpdatePassword(passwordInput) : '',
      [`${valiKeystoreFileKey}_FILE`]: keystoreFilePath,
      [`${valiKeystoreFileKey}_PASSWORD`]: savePassword ? processAndUpdatePassword(passwordInput) : '',
    };
  }

  updateEnvFile(updateDatas);

  console.log(`\n${Font.colorize('!!!Remember to backup this file!!!', Font.fgRed)}`);
  console.log(`${Font.colorize(`Saved successfully: ${keystoreFilePath}`, Font.fgGreen)}\n`);
  return keystoreFilePath;
}

async function generateKeystore(username) {
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
  await saveKeystore(privateKey, username);

  return { privateKey, publicKey, username };
}

async function importAccountAndSaveKeystore(privateKey) {
  return await retry(async () => {
    const accountName = await input({
      message: 'Enter your account name (1-8 characters): ',
    });
    const accountInfo: any = await getUserAccount(normalizeAccountName(accountName));
    if (
      privateKey.toPublic().toString() === accountInfo.pubkey ||
      privateKey.toPublic().toLegacyString() === accountInfo.pubkey
    ) {
      return { accountName, ...accountInfo };
    }
    console.log(`${Font.fgYellow}${Font.bright}Account name is not matched, please try again.${Font.reset}`);
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

export async function importFromMnemonic() {
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
  return await processAccount(privateKey, accountInfo.accountName);
}

export async function importFromPrivateKey() {
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
  return await processAccount(privateKey, account.accountName);
}

export async function getAccountRole(accountName) {
  accountName = normalizeAccountName(accountName);
  const tableApi = await TableApi.getInstance();
  const sync = await tableApi.getSynchronizerInfo(accountName);
  const vali = await tableApi.getValidatorInfo(accountName);
  if ((sync && vali) || (!sync && !vali)) {
    return await getInputRole();
  }
  if (sync) return Client.Synchronizer;
  if (vali) return Client.Validator;
}

export async function processAccount(privateKey, accountName) {
  const role = await getAccountRole(accountName);
  await saveKeystore(privateKey, accountName, role);
  return true;
}

export async function initializeAccount() {
  if (keystoreExist(Client.Synchronizer) || keystoreExist(Client.Validator)) {
    console.log(`\n${Font.fgYellow}${Font.bright}Keystore file is exist.${Font.reset}`);
    return;
  }
  const username = await input({
    message: 'Enter an account name (1-8 characters, a-z, 1-5. Input "q" to return): ',
    validate: async (input) => {
      if (input === 'q') return true;
      if (!validateUsername(input)) {
        return 'Please enter an account name that is 1-8 characters long, contains only a-z and 1-5.';
      }
      try {
        const exist = await getUserAccount(input);
        if (exist) return 'This username is already registered. Please enter another one.';
        return true;
      } catch (error: any) {
        return `Request error: ${error.message}`;
      }
    },
  });
  if (username === 'q') return false;
  console.log(Font.colorize(`  Your account : ${username}.sat`, Font.fgGreen));

  await generateKeystore(username);
  return username;
}
