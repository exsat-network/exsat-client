# exSat Client

The current Git repository only describes the operations on the client side. If you need complete instructions on how to
register and run the Synchronizer and Validator on the exSat network, please refer to this link for more comprehensive
information: [https://docs.exsat.network/get-started](https://docs.exsat.network/get-started).

## Hardware Requirement

Recommended Configuration:

- **CPU**: 2 Cores
- **RAM**: 4GB
- **Disk**: 50GB

## Operating System

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

```shell
git clone https://github.com/exsat-network/exsat-client.git
cd exsat-client
yarn install
yarn build
```

### Configure the Environment Variables

Navigate to the project directory (e.g.exsat-client), copy the _.env.example_ file to create a new .env file, edit the
newly created _.env_ file.

```
cp .env.example .env
vim .env
```

This is a simplified env configuration file for **synchronizer** with testnet. For other configuration items, please
refer to the _.env.example_ file for more details.

```
# Account Initializer API base URL
ACCOUNT_INITIALIZER_API_BASE_URL=https://registst3.exactsat.io

# Secret key for Account Initializer API
ACCOUNT_INITIALIZER_API_SECRET=f1a033d7-3d59-4c9b-b9e7-fb897b91a8fb

# ExSat RPC URLs configurations
EXSAT_RPC_URLS=["https://chain-tst3.exactsat.io"]

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
```

Save and close the _.env_ File

By following these steps, you will have successfully configured the environment variables needed for your project.

## Start the Client

### Ensure Environment Configuration is Complete

Verify that you have copied _.env.example_ to _.env_ and customized the parameters as described in the previous steps.

### Start the Client with yarn(The keystore password is configured in the .env file)

Open a terminal window.  
Navigate to the project directory, execute different commands based on different roles:

- yarn start-commander
- yarn start-synchronizer
- yarn start-validator

### Start the Client with yarn(The keystore password is provided directly)

| Parameter | Description                                     | Example                                                 |
| --------- | ----------------------------------------------- | ------------------------------------------------------- |
| --pwd     | Provides the password directly.                 | yarn start-<clientType> --pwd mysecretpassword          |
| --pwdfile | Provides the file path containing the password. | yarn start-<clientType> --pwdfile /path/to/password.txt |

### Start the Client with pm2(The keystore password is configured in the .env file)

```shell
yarn build
pm2 start ecosystem.config.js --only synchronizer
pm2 start ecosystem.config.js --only validator
```

## Act as Synchronizer

Please follow the [documents about synchronizer](https://docs.exsat.network/get-started/synchronizer-mining-pools/run-as-synchronizer)
to act as synchronizer.

## Act as Validator

Please follow the [documents about validator](https://docs.exsat.network/get-started/validators/run-as-validator) to act
as validator.

# Install with Docker

`docker pull exsatnetwork/exsat-client:latest`

## Run with Docker

When running the client through Docker, it is recommanded to first run commander in the foreground interactively to
complete account registration and configuration, and then run synchronizer or validator in the background for long-term
operation.

When creating an account, make sure to save your seed phrase carefully. After the client generates the private key using
the seed phrase, it will save the encrypted private key in a keystore file, and you will choose where to save the
keystore file. Be sure to select a path that is mapped to the host machine's storage (e.g. if you're running the docker
with the supplied "-v" parameters as below example codes, in the "Choose a directory to save the keystore" step, you
could choose the option that save the keystore at /app/.exsat). This way, the keystore file will be saved on the host
machine. Otherwise, if you remove the Docker container, the keystore file will be lost, and you will need to regenerate
the keystore file by importing the seed phrase.

**It is highly recommended that the .env file and keystore file be placed in the same directory.**

## Run commander

```shell
docker run -it --name commander -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=commander exsatnetwork/exsat-client:latest
```

## Run synchronizer

```shell
docker run -d --name synchronizer -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=synchronizer exsatnetwork/exsat-client:latest
docker logs -f --tail=100 synchronizer
```

## Run validator

```shell
docker run -d --name validator -v $HOME/.exsat:/app/.exsat -e CLIENT_TYPE=validator exsatnetwork/exsat-client:latest
docker logs -f --tail=100 validator
```
