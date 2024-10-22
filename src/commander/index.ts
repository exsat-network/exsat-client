import { configureLogger, logger } from '../utils/logger';
import { select } from '@inquirer/prompts';
import { SynchronizerCommander } from './synchronizer';
import { ValidatorCommander } from './validator';
import { Version } from '../utils/version';
import { updateMenu } from './common';
import { Client } from '../utils/enumeration';
import { isExsatDocker, showInfo } from '../utils/common';

/**
 * Main entry point for the application.
 * Checks for updates, displays user guide information, and prompts user to select a client to start.
 */
async function main() {
  showInfo({
    'Please note':
      'It is highly recommended that you carefully read the user guide and follow the instructions precisely to avoid any unnecessary issues.',
    'User Guide': 'https://docs.exsat.network/guides-of-data-consensus/quick-start',
  });

  // Define menu options for client selection
  const menus = [
    { name: 'Synchronizer', value: Client.Synchronizer },
    { name: 'Validator', value: Client.Validator },
  ];

  // Prompt user to select a client to start
  const role = await select({
    message: 'Please select the client to start: ',
    choices: menus,
  });

  const isDocker = isExsatDocker();
  // Check for software updates
  let versions;
  if (isDocker) {
    versions = await Version.checkForDockerUpdates();
  } else {
    versions = await Version.checkForUpdates();
  }
  if (versions.newVersion) {
    await updateMenu(versions, isDocker, role);
  }
  // Initialize the selected client and configure logger
  let clientCommander;
  switch (role) {
    case Client.Synchronizer:
      clientCommander = new SynchronizerCommander();
      break;
    case Client.Validator:
      clientCommander = new ValidatorCommander();
      break;
    default:
      throw new Error('Invalid client selection');
  }

  // Start the selected client
  configureLogger('commander');
  await clientCommander.main();
}

// Execute the main function and handle any errors
(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
