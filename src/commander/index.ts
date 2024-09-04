import { configureLogger, logger } from "../utils/logger";
import { select } from "@inquirer/prompts";
import { SynchronizerCommander } from "./synchronizer";
import { ValidatorCommander } from "./validator";

async function main() {

  console.log(
    '-------------------------------\n' +
    'Please note: It is highly recommended that you carefully read the user guide and follow the instructions precisely to avoid any unnecessary issues.\n' +
    'User Guide: https://docs.exsat.network/user-guide-for-testnet-hayek\n' +
    '-------------------------------'
  );
  const menus = [
    {
      name: 'synchronizer',
      value: 'synchronizer',
    },
    {
      name: 'validator',
      value: 'validator',
    },
  ]
  const action = await select({ message: 'Please select the client to start:', choices: menus });
  let client;
  switch (action) {
    case 'synchronizer':
      configureLogger('synchronizer_client');
      client = new SynchronizerCommander();
      break;
    case 'validator':
      configureLogger('validator_client');
      client = new ValidatorCommander();
      break;
  }
  await client.main();
}

(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
