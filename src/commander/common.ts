import { input, select, Separator } from '@inquirer/prompts';
import { importFromMnemonic, importFromPrivateKey, initializeAccount } from '@exsat/account-initializer';
import process from 'node:process';
import { Font } from '../utils/font';
import { EXSAT_RPC_URLS } from '../utils/config';
import { getRpcUrls, isExsatDocker } from '../utils/common';
import { Client } from '../utils/enumeration';

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
    message: 'Select Action: ',
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
      name: 'Method',
      value: 'get_docker_upgrade',
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
    message: 'Select Action: ',
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
