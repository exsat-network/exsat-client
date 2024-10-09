import { input, select, Separator } from '@inquirer/prompts';
import { importFromMnemonic, importFromPrivateKey, initializeAccount } from '@exsat/account-initializer';
import process from 'node:process';
import { Font } from '../utils/font';

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
    create_account: async () => await initializeAccount(role),
    import_seed_phrase: async () => await importFromMnemonic(role),
    import_private_key: async () => await importFromPrivateKey(role),
    quit: async () => process.exit(0),
  };

  const action = await select({
    message: 'Select Action:',
    choices: menus,
  });
  await (actions[action] || (() => {
  }))();
}

export async function updateMenu(versions) {
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
    `Client Current Version:${Font.reset}${Font.bright} ${versions.current}${Font.reset}\n` +
    Font.colorize(`Client Latest Version: ${versions.latest}`, Font.fgYellow) +
    `${Font.fgCyan}${Font.bright}\n-----------------------------------------------${Font.reset}\n`
  );
  const action = await select({
    message: 'Select Action:',
    choices: menus,
  });
  switch (action) {
    case 'get_upgrade_method':
      console.log('\nPlease enter the following command in the terminal to complete the version upgrade:');
      console.log(`git fetch --tags && git checkout -f ${versions.latest} \n`);
      await input({ message: 'Press Enter to Continue...' });
      process.exit(0);
      break;
    default:
      return;
  }
}
