import { input, select, Separator, confirm } from '@inquirer/prompts';
import { importFromMnemonic, importFromPrivateKey, initializeAccount } from '@exsat/account-initializer';
import process from 'node:process';
import { Font } from '../utils/font';
import { EXSAT_RPC_URLS } from '../utils/config';
import { getRpcUrls, isExsatDocker, isValidUrl } from '../utils/common';
import { Client } from '../utils/enumeration';
import { logger } from '../utils/logger';
import { inputWithCancel } from '../utils/input';
import { updateEnvFile } from '@exsat/account-initializer/dist/utils';

export async function notAccountMenu(role) {
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
      const res = await initializeAccount(role);
      if (res) {
        console.log(
          `${Font.fgCyan}${Font.bright}Account registration may take a moment, please wait.\nConfirmation email will be sent to your inbox after the account registration is complete.\nPlease follow the instructions in the email to complete the subsequent Synchronizer registration.\n-----------------------------------------------${Font.reset}`
        );
        process.exit(0);
      }
    },
    import_seed_phrase: async () => await importFromMnemonic(role),
    import_private_key: async () => await importFromPrivateKey(role),
    quit: async () => process.exit(0),
  };

  const action = await select({
    message: 'Select an Action: ',
    choices: menus,
  });
  let res;
  do {
    res = await (actions[action] || (() => {}))();
  } while (!res);
}

export async function updateMenu(versions, isDocker, role) {
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
        console.log(
          `\n${Font.fgCyan}${Font.bright}Please exit the Docker container and follow the instructions in the documentation to upgrade your Docker: ${role == Client.Synchronizer ? 'http://synchronzier' : 'http://validator'}${Font.reset}`
        );
      } else {
        console.log(
          `\n${Font.fgCyan}${Font.bright}Please enter the following command in the terminal to complete the version upgrade: ${Font.reset}`
        );
        console.log(`${Font.bright}git fetch --tags && git checkout -f ${versions.latest} ${Font.reset}\n`);
      }
      await input({ message: 'Press Enter to Continue...' });
      process.exit(0);
      break;
    default:
      return;
  }
}

export async function checkExsatUrls() {
  if (EXSAT_RPC_URLS.length === 0) {
    const result = await getRpcUrls();
    if (result && result.status === 'success' && result.info?.exsat_rpc) {
      // @ts-ignore
      EXSAT_RPC_URLS = result.info.exsat_rpc;
    }
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
