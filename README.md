# exSat Official Testnet

The current Git repository only describes the operations on the client side. If you need complete instructions on how to register and run the Synchronizer and Validator on the exSat hayek testnet, please refer to this link for more comprehensive information: [https://docs.exsat.network/user-guide-for-testnet-hayek](https://docs.exsat.network/user-guide-for-testnet-hayek).

## Hardware Requirement

Recommended Configuration:

- **CPU**: 2 Cores
- **RAM**: 4GB
- **Disk**: 50GB

## Operation System

Recommend to use Ubuntu system, or other Linux systems.

## Prerequisites

Ensure the following tools are installed on your system:

- **Git**
  - Check: `git --version`
  - Install: [Git Installation Guide](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- **Node.js** (version 20.0.0 or higher)
  - Check: `node -v`
  - Install: [Node.js Installation Guide](https://nodejs.org/en/download/package-manager)
- **Yarn**
  - Check: `yarn -v`
  - Install: [Yarn Installation Guide](https://classic.yarnpkg.com/en/docs/install)
- **PM2**
  - Check: `pm2 -v`
  - Install: `npm install -g pm2`

## Downloading Client Code and Installing Dependencies

Some commands may need the root account permission to execute, please use sudo as needed.

### Download the Client

Open a terminal window.  
Execute the following command to clone the repository :

```
https://github.com/exsat-network/exsat-client.git
```

### Configure the Environment Variables

Navigate to the project directory (e.g.exsat-client), Copy the .env.example file to create a new .env file, edit the newly created .env file.

```
cp .env.example .env
vim .env
```

Here's an explaination of the parameters for Synchronizers:

```
# Common configurations
# Account Initializer API base URL
ACCOUNT_INITIALIZER_API_BASE_URL=https://registst3.exactsat.io

# Secret key for Account Initializer API
ACCOUNT_INITIALIZER_API_SECRET=f1a033d7-3d59-4c9b-b9e7-fb897b91a8fb

# Logger configurations
# Maximum size for each log file (30 MB)
LOGGER_MAX_SIZE=30m

# Directory where log files are stored
LOGGER_DIR=logs

# Maximum age for log files (30 days)
LOGGER_MAX_FILES=30d

# ExSat RPC URLs configurations
EXSAT_RPC_URLS=["https://chain-tst3.exactsat.io"]

# Bitcoin RPC URL
BTC_RPC_URL=

# Bitcoin RPC username
BTC_RPC_USERNAME=

# Bitcoin RPC password
BTC_RPC_PASSWORD=
################################################################################
# Synchronizer configurations(is required only for the synchronizer)
# Size of each upload chunk (256 KB). Be careful! Modifying this configuration may cause block uploading failure. It must not be less than 100 KB.
CHUNK_SIZE=262144

# Scheduler for block upload jobs (every second)
SYNCHRONIZER_JOBS_BLOCK_UPLOAD=*/1 * * * * *

# Scheduler for block verify jobs (every second)
SYNCHRONIZER_JOBS_BLOCK_VERIFY=*/1 * * * * *

# Scheduler for block parse jobs (every 5 seconds)
SYNCHRONIZER_JOBS_BLOCK_PARSE=*/5 * * * * *

# File path to the synchronizer's keystore
SYNCHRONIZER_KEYSTORE_FILE=

# Password for the synchronizer's keystore
SYNCHRONIZER_KEYSTORE_PASSWORD=
################################################################################
# Validator configurations(is required only for the validator)
# Scheduler for endorsement jobs (every second)
VALIDATOR_JOBS_ENDORSE=*/1 * * * * *

# Scheduler for endorsement check jobs (every 1 minute)
VALIDATOR_JOBS_ENDORSE_CHECK=0 * * * * *

# File path to the validator's keystore
VALIDATOR_KEYSTORE_FILE=

# Password for the validator's keystore
VALIDATOR_KEYSTORE_PASSWORD=
################################################################################

# Enable prometheus
PROMETHEUS=false
# Prometheus listen address
PROMETHEUS_ADDRESS=0.0.0.0:9900
################################################################################

```

Save and Close the `.env` File

By following these steps, you will have successfully configured the environment variables needed for your project.

## Start the Client

### Ensure Environment Configuration is Complete

Verify that you have copied `.env.example` to `.env` and customized the parameters as described in the previous steps.

### Start the Client with yarn(The keystore password is configured in the.env file)

Open a terminal window.  
Navigate to the project directory, Start the client by executing the script:

```
yarn start-commander
or
yarn start-synchronizer
or
yarn start-validator
```

### Start the Client with yarn(The keystore password is provided directly)

| Parameter   | Description                                     | Example                                                   |
| ----------- | ----------------------------------------------- | --------------------------------------------------------- |
| `--pwd`     | Provides the password directly.                 | `yarn start-<clientType> --pwd mysecretpassword`          |
| `--pwdfile` | Provides the file path containing the password. | `yarn start-<clientType> --pwdfile /path/to/password.txt` |

### Start the Client with pm2(The keystore password is configured in the.env file)

```shell
yarn build
pm2 start ecosystem.config.js --only synchronizer
pm2 start ecosystem.config.js --only validator
```

## Act as Synchronizer

Please follow the [documents about synchronizer](https://docs.exsat.network/user-guide-for-testnet-nexus/synchronizer) to act as synchronizer.

## Act as Validator

Please follow the [documents about validator](https://docs.exsat.network/user-guide-for-testnet-nexus/validator) to act as validator.

# Install with Docker

`docker pull exsatnetwork/exsat-client:latest`

## Run with Docker

When running the client through Docker, it is recommanded to first run commander in the foreground interactively to complete account registration and configuration, and then run synchronizer or validator in the background for long-term operation.

When creating an account, make sure to save your seed phrase carefully. After the client generates the private key using the seed phrase, it will save the encrypted private key in a keystore file, and you will choose where to save the keystore file. Be sure to select a path that is mapped to the host machine's storage (e.g. if you're running the docker with the supplied "-v" parameters as below example codes, in the "Choose a directory to save the keystore" step, you could choose the option that save the keystore at /root/.exsat). This way, the keystore file will be saved on the host machine. Otherwise, if you remove the Docker container, the keystore file will be lost, and you will need to regenerate the keystore file by importing the seed phrase.

## Run commander

```shell
docker run -it --name commander -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=commander exsatnetwork/exsat-client:latest
```

## Run synchronizer

```shell
docker run -d --name synchronizer -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=synchronizer exsatnetwork/exsat-client:latest
docker logs -f synchronizer
```

## Run validator

```shell
docker run -d --name validator -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=validator exsatnetwork/exsat-client:latest
docker logs -f validator
```
