import { confirm, input, password, select, Separator } from '@inquirer/prompts';
import process from 'node:process';
import { Font } from '../utils/font';
import { NETWORK, NETWORK_CONFIG } from '../utils/config';
import { isValidUrl, retry, showInfo, updateEnvFile } from '../utils/common';
import { Client, ClientType } from '../utils/enumeration';
import { logger } from '../utils/logger';
import { clearLines, inputWithCancel } from '../utils/input';
import { getUserAccount, importFromMnemonic, importFromPrivateKey, initializeAccount } from './account';
import { getAccountInfo, getBaseAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import fs from 'node:fs';

export async function notAccountMenu() {
  const menus = [
    {
      name: 'Create New Account',
      value: 'create_account',
      description: 'Create New Account',
    },
    {
      name: 'Import Seed Phrase',
      value: 'import_seed_phrase',
      description: 'Import Seed Phrase',
    },
    {
      name: 'Import Private Key',
      value: 'import_private_key',
      description: 'Import Private Key',
    },
    new Separator(),
    { name: 'Quit', value: 'quit', description: 'Quit' },
  ];
  //
  const actions: { [key: string]: () => Promise<any> } = {
    create_account: async () => {
      return await initializeAccount();
    },
    import_seed_phrase: async () => {
      return await importFromMnemonic();
    },
    import_private_key: async () => {
      return await importFromPrivateKey();
    },
    quit: async () => process.exit(0),
  };

  let res;
  do {
    const action = await select({
      message: 'Create a new account or use your exist account: ',
      choices: menus,
    });
    res = await (actions[action] || (async () => {}))();
  } while (!res);
}

export async function updateMenu(versions, isDocker) {
  const menus = [
    {
      name: 'Get Upgrade Method',
      value: 'get_upgrade_method',
    },
    {
      name: 'Skip',
      value: '99',
    },
  ];
  console.log(
    `${Font.fgCyan}${Font.bright}-----------------------------------------------\n` +
      `Client Current Version: ${Font.reset}${Font.bright}${versions.current}${Font.reset}\n` +
      Font.colorize(`Client Latest Version: ${versions.latest}`, Font.fgYellow) +
      `${Font.fgCyan}${Font.bright}\n-----------------------------------------------${Font.reset}\n`
  );
  const action = await select({
    message: 'Select an Action: ',
    choices: menus,
  });
  switch (action) {
    case 'get_upgrade_method':
      if (isDocker) {
        // URLs for Docker upgrade instructions based on user role
        const docsUrl =
          'https://docs.exsat.network/guides-of-data-consensus/others/operation-references/common-operations/upgrade-to-new-version';

        console.log(
          `\n${Font.fgCyan}${Font.bright}Please exit the Docker container and follow the instructions in the documentation to upgrade your Docker: \n${Font.reset}${Font.bright}${docsUrl}${Font.reset}`
        );
      } else {
        console.log(
          `\n${Font.fgCyan}${Font.bright}Please enter the following command in the terminal to complete the version upgrade: ${Font.reset}`
        );
        console.log(`${Font.bright}git fetch --tags && git checkout -f ${versions.latest} ${Font.reset}\n`);
      }
      await input({ message: 'Press [Enter] to continue...' });
      clearLines(1);
      process.exit(0);
      break;
    default:
      return;
  }
}

/**
 * Sets the BTC RPC URL, username, and password.
 */
export async function setBtcRpcUrl() {
  const btcRpcUrl = await inputWithCancel('Please enter new BTC_RPC_URL(Input "q" to return): ', (input) => {
    if (!isValidUrl(input)) {
      return 'Please enter a valid URL';
    }
    return true;
  });
  if (!btcRpcUrl) {
    return false;
  }
  const values: { [key: string]: string } = {
    BTC_RPC_URL: btcRpcUrl,
    BTC_RPC_USERNAME: '',
    BTC_RPC_PASSWORD: '',
  };

  if (
    await confirm({
      message: 'Do You need to configure the username and password?',
    })
  ) {
    const rpcUsername = await inputWithCancel('Please enter RPC username(Input "q" to return): ');
    if (!rpcUsername) {
      return false;
    }
    const rpcPassword = await inputWithCancel('Please enter RPC password(Input "q" to return): ');
    if (!rpcPassword) {
      return false;
    }
    values['BTC_RPC_USERNAME'] = rpcUsername;
    values['BTC_RPC_PASSWORD'] = rpcPassword;
  }

  updateEnvFile(values);

  process.env.BTC_RPC_URL = btcRpcUrl;
  process.env.BTC_RPC_USERNAME = values['BTC_RPC_USERNAME'];
  process.env.BTC_RPC_PASSWORD = values['BTC_RPC_PASSWORD'];

  logger.info('.env file has been updated successfully.');
  return true;
}

/**
 * Resets the BTC RPC URL after confirmation.
 */
export async function resetBtcRpcUrl() {
  const rpcUrl = process.env.BTC_RPC_URL;
  if (rpcUrl) {
    if (
      !(await confirm({
        message: `Your BTC_RPC_URL: ${rpcUrl}\nAre you sure to change it?`,
      }))
    ) {
      return;
    }
  }
  return await setBtcRpcUrl();
}

/**
 * Exports the private key.
 * @param privateKey
 */
export async function exportPrivateKey(privateKey: string) {
  console.log(`Private Key: ${privateKey}`);
  await input({ message: 'Press [Enter] to continue...' });
  clearLines(2);
  return true;
}

export async function checkAccountRegistrationStatus(clientType) {
  const exsatAccountInfo = await getBaseAccountInfo(getKeystorePath(clientType));
  let checkAccountInfo = await getUserAccount(exsatAccountInfo.accountName);
  if (!checkAccountInfo) {
    showInfo({
      'Account Name': exsatAccountInfo.accountName,
      'Public Key': exsatAccountInfo.publicKey,
      'Registration Url': `${NETWORK_CONFIG.register}?account=${exsatAccountInfo.accountName}&pubkey=${exsatAccountInfo.publicKey}${NETWORK == 'mainnet' ? '' : `&net=${NETWORK}`}`,
    });
    console.log(
      `Please note that your registration has not finished yet!\n${Font.fgGreen}${Font.bright}Please copy the Registration Url above and paste to your browser to finish the registration.${Font.reset}`
    );
    const menus = [
      {
        name: 'I have successfully paid the registration fee and can continue to proceed further actions.',
        value: 'check_account',
      },
      {
        name: 'Quit',
        value: 'quit',
      },
    ];
    const actions: { [key: string]: () => Promise<any> } = {
      check_account: async () => {
        const userAccount = await getUserAccount(exsatAccountInfo.accountName);
        if (userAccount) return userAccount;
        logger.warn(`Account ${exsatAccountInfo.accountName} is not registered yet.`);
        return false;
      },
      quit: async () => process.exit(),
    };
    await promptMenuLoop(menus, actions);
    // Account registration has been completed successfully.
    console.log(`\n${Font.fgGreen}${Font.bright}Account registration has been completed successfully.${Font.reset}\n`);
  }
  return true;
}

/**
 * Removes the keystore file after confirming the password.
 */
export async function removeKeystore(clientType: ClientType) {
  try {
    const keystoreFile = getKeystorePath(clientType);
    await retry(async () => {
      const passwordInput = await password({
        message:
          'Enter your password to remove account\n(The program will exit after 5 failed attempts, Input "q" to return): ',
        mask: '*',
      });
      if (passwordInput === 'q') {
        return false;
      }
      await getAccountInfo(keystoreFile, passwordInput);
      fs.unlinkSync(keystoreFile);
      const client = clientType === ClientType.Validator ? Client.Validator : Client.Synchronizer;
      updateEnvFile({
        [`${client.toUpperCase()}_KEYSTORE_FILE`]: '',
        [`${client.toUpperCase()}_KEYSTORE_PASSWORD`]: '',
      });
      logger.info('Remove account successfully');
      process.exit();
    }, 5);
  } catch (e) {
    logger.error('Invalid password');
    process.exit();
  }
}

export function getKeystoreBaseInfo(clientType) {
  return getBaseAccountInfo(getKeystorePath(clientType));
}

export async function decryptKeystore(clientType) {
  const keystoreFile = getKeystorePath(clientType);
  let password = getConfigPassword(clientType);
  let accountInfo;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(keystoreFile, password);
  } else {
    while (!accountInfo) {
      try {
        password = await getInputPassword();
        if (password === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(keystoreFile, password);
      } catch (e) {
        logger.warn('Failed to decrypt keystore with provided password.');
        console.log('Please try again with the correct password.');
      }
    }
  }
  return accountInfo;
}

/**
 * Gets the keystore path based on the client type.
 * @param clientType
 */
export function getKeystorePath(clientType: ClientType): string {
  const keystoreFile =
    clientType === ClientType.Synchronizer
      ? process.env.SYNCHRONIZER_KEYSTORE_FILE
      : process.env.VALIDATOR_KEYSTORE_FILE;

  if (!fs.existsSync(keystoreFile)) {
    logger.error(
      `No ${clientType === ClientType.Synchronizer ? 'synchronizer' : 'validator'} keystore file found, please config .env file first`
    );
    process.exit(1);
  }

  return keystoreFile;
}

export async function howToClaimReward() {
  console.log(
    `Please go to the Consensus Portal page and connect with your reward address to claim rewards and commission.\nConsensus Portal Url: ${Font.bright}${Font.fgGreen}${NETWORK_CONFIG.portal}${Font.reset}\n`
  );
  await input({ message: 'Press [Enter] to continue...' });
  clearLines(1);
  return true;
}

export async function stakeClaimManagement(client: Client) {
  let message;
  switch (client) {
    case Client.Synchronizer:
      message = 'Please go to the Consensus Portal page and connect with your stake address to claim rewards.';
      break;
    case Client.Validator:
      message =
        'Please go to the Consensus Portal page and connect with your stake address or commission address to stake BTC or claim rewards and commission.';
      break;
    case Client.XSATValidator:
      message =
        'Please go to the Consensus Portal page and connect with your stake address to stake XSAT or claim rewards.';
      break;
    default:
      message = 'Please go to the Consensus Portal page and connect with your stake address to claim rewards.';
  }
  console.log(`${message}\nConsensus Portal Url: ${Font.bright}${Font.fgGreen}${NETWORK_CONFIG.portal}${Font.reset}\n`);
  await input({ message: 'Press [Enter] to continue...' });
  clearLines(1);
  return true;
}

/**
 * Common menu selection loop
 * @param choices Menu Options Array
 * @param actions Operation Map Table { [actionKey: string]: () => Promise<any> }
 * @param title Menu title (default 'Select an Action')
 * @param mainMenu Whether it is the main menu (default false)
 */
export async function promptMenuLoop(
  choices: any[],
  actions: Record<string, () => Promise<any>>,
  title: string = 'Select an Action',
  mainMenu: boolean = false
) {
  let shouldContinue = true;
  do {
    const action: string = await select({
      message: title,
      choices,
      loop: false,
      pageSize: 20,
    });

    // Perform an operation and decide whether to continue the loop
    if (actions[action]) {
      const result = await actions[action]();
      shouldContinue = result === false; // Allow operation to return false Force exit
    } else {
      logger.error('Invalid operation');
      shouldContinue = false;
    }
  } while (shouldContinue || mainMenu);
}
