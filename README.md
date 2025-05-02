# exSat Client

The current Git repository only describes the operations on the client side. If you need complete instructions on how to register and run the Synchronizer and Validator on the exSat network, please refer to this link for more comprehensive information: [https://docs.exsat.network/get-started](https://docs.exsat.network/get-started).

## Table of Contents

- [Hardware Requirement](#hardware-requirement)
- [Operating System](#operating-system)
- [Prerequisites](#prerequisites)
- [Configuring the Environment Variables](#configuring-the-environment-variables)
- [Acting as Synchronizer](#acting-as-synchronizer)
- [Acting as Validator](#acting-as-validator)
- [Installing from Source](#installing-from-source)
- [Using PM2 for Process Management](#using-pm2-for-process-management)
- [Troubleshooting](#troubleshooting)
- [Running with Docker](#running-with-docker)

## Hardware Requirement

Recommended Configuration:

- **CPU**: 2 Cores
- **RAM**: 4GB
- **Disk**: 50GB

## Operating System

It is recommended to use the Ubuntu system or other Linux distributions.

## Prerequisites

### For Source Installation

If you choose to install from the source, ensure the following tools are installed on your system:

- **Git**

  - Check: `git --version`
  - Install: [Git Installation Guide](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)

- **Node.js** (version 20.0.0 or higher)

  - Check: `node -v`
  - Install: [Node.js Installation Guide](https://nodejs.org/en/download/package-manager)

- **Yarn**

  - Check: `yarn -v`
  - Install: `npm install -g yarn`

- **PM2**
  - Check: `pm2 -v`
  - Install: `npm install -g pm2`

### For Docker Installation

- **Docker**
  - If you haven't installed Docker yet, please follow the [Docker Installation Guide](https://docs.docker.com/get-docker/).

## Configuring the Environment Variables

Regardless of whether you choose to run from source or Docker, you must configure the environment variables. Follow these steps:

1. Navigate to your project directory (for source installation) or your desired path (for Docker).
2. Copy the example environment configuration file to create a new `.env` file and edit it.

```shell
cp .env.example .env
vim .env
```

This is a simplified env configuration file. For all configuration items, please refer to the `.env.example` file for more details.

```
# Network configurations: mainnet or testnet
# NETWORK=

# Bitcoin RPC URL
BTC_RPC_URL=

# Bitcoin RPC username
BTC_RPC_USERNAME=

# Bitcoin RPC password
BTC_RPC_PASSWORD=

# File path to the synchronizer's keystore
SYNCHRONIZER_KEYSTORE_FILE=

# Password for the synchronizer's keystore
SYNCHRONIZER_KEYSTORE_PASSWORD=

# File path to the validator's keystore
VALIDATOR_KEYSTORE_FILE=

# Password for the validator's keystore
VALIDATOR_KEYSTORE_PASSWORD=
```

Save and close the `.env` file.

## Acting as Synchronizer

Please follow the [documents about synchronizer](https://docs.exsat.network/get-started/synchronizer-mining-pools/run-as-synchronizer) to act as a synchronizer.

## Acting as Validator

Please follow the [documents about validator](https://docs.exsat.network/get-started/validators/run-as-validator) to act as a validator.

## Installing from Source

Some commands may require root account permissions; please use `sudo` as needed.

### Download the Client

Open a terminal window.
Execute the following command to clone the repository:

```shell
git clone https://github.com/exsat-network/exsat-client.git
cd exsat-client
yarn install
yarn build
```

### Starting the Client (Source)

Ensure environment configuration is complete by following the steps in the **Configuring the Environment Variables** section.

Open a terminal window.
Navigate to the project directory and execute the commands based on different roles:

- Start Commander:

  ```bash
  yarn start-commander
  ```

- Start Synchronizer:

  ```bash
  yarn start-synchronizer
  ```

- Start Validator:
  ```bash
  yarn start-validator
  ```

#### Using PM2 for Process Management

If you prefer to manage the client processes with PM2, you need to build the project first with `yarn build`. Then you can use the following commands:

**Note: Ensure that the keystore password is configured in the .env file.**

- Start Synchronizer with PM2:

  ```bash
  pm2 start yarn --name synchronizer -- start-synchronizer
  ```

  or

  ```bash
  pm2 start ecosystem.config.js --only synchronizer
  ```

- Start Validator with PM2:
  ```bash
  pm2 start yarn --name validator -- start-validator
  ```
  or
  ```bash
  pm2 start ecosystem.config.js --only validator
  ```

You can check the status of your PM2 processes with:

```bash
pm2 list
```

## Troubleshooting

- **Issue**: Startup failure with permission denied.

  - **Solution**: Ensure you are running the commands under the correct user; use `sudo` if necessary.

- **Issue**: Dependency installation failure.
  - **Solution**: Ensure Node.js and Yarn are correctly installed and the versions meet the requirements.

## Running with Docker

### Pull the Docker Image

```shell
docker pull exsatnetwork/exsat-client:latest
```

### Starting the Client (Docker)

Ensure that you first configure the environment variables as described above.

To run the client using Docker, follow these steps:

#### Run Commander

```shell
# Run Commander with the keystore password configured in the .env file
docker run --rm -it -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=commander exsatnetwork/exsat-client:latest

# Run Commander with the keystore password provided directly
docker run --rm -it -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=commander -e VALIDATOR_KEYSTORE_PASSWORD=123456 exsatnetwork/exsat-client:latest
```

#### Run Synchronizer

```shell
# Run Synchronizer with the keystore password configured in the .env file
docker run -d --name synchronizer -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=synchronizer exsatnetwork/exsat-client:latest

# Run Synchronizer with the keystore password provided directly
docker run -d --name synchronizer -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=synchronizer -e VALIDATOR_KEYSTORE_PASSWORD=123456 exsatnetwork/exsat-client:latest

# Fetches the last 100 lines of Docker logs
docker logs -f --tail=100 synchronizer
```

#### Run Validator

```shell
# Run Validator with the keystore password configured in the .env file
docker run -d --name validator -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=validator exsatnetwork/exsat-client:latest

# Run Validator with the keystore password provided directly
docker run -d --name validator -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=validator -e VALIDATOR_KEYSTORE_PASSWORD=123456 exsatnetwork/exsat-client:latest

# Fetches the last 100 lines of Docker logs
docker logs -f --tail=100 validator
```
