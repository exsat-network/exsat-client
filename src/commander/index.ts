import { configureLogger, logger } from "../utils/logger";
import { select } from "@inquirer/prompts";
import { SynchronizerCommander } from "./synchronizer";
import { ValidatorCommander } from "./validator";
import { Version } from "../utils/version";
import { updateMenu } from "./common";

/**
 * Main entry point for the application.
 * Checks for updates, displays user guide information, and prompts user to select a client to start.
 */
async function main() {
  // Check for software updates
  const versions = await Version.checkForUpdates('message');
  if (versions.newVersion) {
    await updateMenu(versions);
  }

  // Display user guide information
  console.log(
    '-------------------------------\n' +
    'Please note: It is highly recommended that you carefully read the user guide and follow the instructions precisely to avoid any unnecessary issues.\n' +
    'User Guide: https://docs.exsat.network/user-guide-for-testnet-hayek\n' +
    '-------------------------------'
  );

  // Define menu options for client selection
  const menus = [
    { name: 'synchronizer', value: 'synchronizer' },
    { name: 'validator', value: 'validator' },
  ];

  // Prompt user to select a client to start
  const action = await select({ message: 'Please select the client to start:', choices: menus });

  // Initialize the selected client and configure logger
  let client;
  switch (action) {
    case 'synchronizer':
      client = new SynchronizerCommander();
      break;
    case 'validator':
      client = new ValidatorCommander();
      break;
    default:
      throw new Error('Invalid client selection');
  }

  // Start the selected client
  configureLogger('commander');
  await client.main();
}

// Execute the main function and handle any errors
(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
