# exSat Official Testnet

The current Git repository only describes the operations on the client side. If you need complete instructions on how to register and run the Synchronizer and Validator on the exSat hayek testnet, please refer to this link for more comprehensive information: [https://docs.exsat.network/user-guide-for-testnet-hayek](https://docs.exsat.network/user-guide-for-testnet-hayek).

## Hardware Requirement

Recommended Configuration:

CPU: 2 Cores

RAM: 4GB

Disk: 50GB

## Operation System

Recommend to use Ubuntu 22.04.4 LTS. Other supported Linux OS version:

CentOS 7

CentOS 7.x

CentOS 8

Ubuntu 18.04

Ubuntu 20.04

Ubuntu 22.04

## Prerequisites

### Node.js

#### Step 1: Check if Node.js is Installed

1. Open a terminal window.
2. To check if Node.js is installed, run the following command:

   ```
   node -v
   ```
3. If Node.js is installed, the terminal will display the version number, such as `v20.15.1`.

#### Step 2: Verify Node.js Version

Current version had been tested on Nodejs v20.15.1, it's not guaranteed it works well on other Nodejs versions.

1. If Node.js is installed, ensure that the version is `20.15.1` or higher.
2. If the installed version is lower than `20.15.1` or Node.js is not installed, proceed to the installation steps below.

#### Step 3: Install Node.js Version 20.15.1

1. To install Node.js version 20.15.1, first ensure your system is updated:

   ```
   sudo apt update
   ```
2. Install Node.js from the NodeSource repository:

   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
3. Verify the installation by checking the Node.js version again:

   ```
   node -v
   ```

   This should return v20.15.1 or a higher version if installed successfully.

### Git

#### Step 1: Check if Git is Installed

1. To check if Git is installed, run the following command in the terminal:

   ```
   git --version
   ```
2. If Git is installed, the terminal will display the version number, such as `git version 2.25.1`.

#### Step 2: Install Git if Not Installed

1. If Git is not installed, you can install it by running the following commands:

   ```
   sudo apt update
   sudo apt install -y git
   ```
2. Verify the installation by checking the Git version:

   ```
   git --version
   ```

   This should return the version number of Git, confirming the installation.

```
By following these steps, you will ensure that both Node.js (version
```

`20.15.1` or higher) and Git are installed and properly configured on your Ubuntu system.

### Yarn

#### Step 1: Install Yarn (if not installed)

1. Open a terminal window.
   Check if Yarn is installed by running:

   ```
   yarn -v
   ```

   If Yarn is not installed, add the Yarn repository and install it:
   ```
   curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
   echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
   sudo apt update
   sudo apt install yarn
   ```

#### Step 2: Verify the installation by checking the Yarn version:

```
yarn -v
```

By following these steps, you will ensure that both Node.js (version 20.15.1 or higher) ,Git and Yarn are installed and properly configured on your system.

## Downloading Client Code and Installing Dependencies

Some commands may need the root account permission to execute, please use sudo as needed.

### Download the Client

Open a terminal window.

Execute the following command to clone the repository :

```
git clone https://github.com/exsat-network/client_testnet.git
```

### Grand Permission for Executing the Script

```
cd client_testnet
chmod 755 exsat.sh
```

### Configure the Environment Variables

This is an optional action, please do the configurations as needed.

Navigate to the project directory (e.g.client_testnet/synchronizer), Copy the .env.example file to create a new .env file, edit the newly created .env file.

```
cd synchronizer
cp .env.example .env
vim .env
```

Here's an explaination of the parameters for Synchronizers:

```
   # exSat_RPC
   # RPC URL for accessing the exSat network. 
   # This'll have a default config, normally not needed to change it.
   EXSAT_RPC_URLS=["https://chain.exactsat.io"]
   
   # BTC_RPC
   # RPC node of the BTC node.
   # Need to fetch the BTC block data or header from this node.
   BTC_RPC_URLS=[""]
   
   # Synchronizer configuration : jobs scheduler
   JOBS_OTHER_PARSE=*/5 * * * * *
   JOBS_BLOCK_UPLOAD=*/1 * * * * *
   
   # Synchronizer configuration : upload chunk size 
   CHUNK_SIZE=1024*256
   
   # account-initializer service, normally not needed to change it
   ACCOUNT_INITIALIZER_API_BASE_URL=https://registry.exactsat.io
   ACCOUNT_INITIALIZER_API_SECRET=8f235f31-7fe6-47d5-8ed4-5004c953b3f6
```

Save and Close the `.env` File

By following these steps, you will have successfully configured the environment variables needed for your project.

## Start the Client

### Ensure Environment Configuration is Complete

Verify that you have copied `.env.example` to `.env` and customized the parameters as described in the previous steps.

### Start the Client

Open a terminal window.

Navigate to the project directory (e.g., `clients/synchronizer`).

Start the client by executing the script:

```
./exsat.sh
```

#### Alternatively, you can start the client using Yarn directly. First, navigate to the appropriate directory (`synchronizer` or `validator`), and then execute the command with the desired parameters:

```sh
cd synchronizer && yarn start
```
or 
```sh
cd validator && yarn start
```
#### Parameters

| Parameter       | Description                                                            | Example                                                      |
|-----------------|---------------------------------------------------------------------   |--------------------------------------------------------------|
| `--pwd`         | Provides the password directly.                                        | `yarn start --pwd mysecretpassword`                          |
| `--pwdfile`     | Provides the file path containing the password.                        | `yarn start --pwdfile /path/to/password.txt`                 |
| `--run`         | Directly start the client, skipping the menu operations.               | `yarn start --run`                                           |


## Act as Synchronizer

Please follow the [documents about synchronizer](https://docs.exsat.network/user-guide-for-testnet-nexus/synchronizer) to act as synchronizer.

## Act as Validator

Please follow the [documents about validator](https://docs.exsat.network/user-guide-for-testnet-nexus/validator) to act as validator.

# Install with Docker

## Install synchronizer

```shell
docker pull exsatnetwork/synchronizer:latest
```

## Install validator

```shell
docker pull exsatnetwork/validator:latest
```

# Run with Docker

When running the client through Docker, it is recommanded to first run it in the foreground interactively to complete account registration and configuration, and then run it in the background for long-term operation. 

When creating an account, make sure to save your seed phrase carefully. After the client generates the private key using the seed phrase, it will save the encrypted private key in a keystore file, and you will choose where to save the keystore file. Be sure to select a path that is mapped to the host machine's storage (e.g. if you're running the docker with the supplied "-v" parameters as below example codes, in the "Choose a directory to save the keystore" step, you could choose the option that save the keystore at "/root/.exsat/synchronizer" or "/root/.exsat/validator"). This way, the keystore file will be saved on the host machine. Otherwise, if you remove the Docker container, the keystore file will be lost, and you will need to regenerate the keystore file by importing the seed phrase.

## Run synchronizer
```shell
mkdir -p $HOME/.exsat/synchronizer
curl -o $HOME/.exsat/synchronizer/.env https://raw.githubusercontent.com/exsat-network/client_testnet/master/synchronizer/.env.example
```

Edit your .env file
```shell
vim $HOME/.exsat/synchronizer/.env
```

Using Docker interactive commands
```shell
docker run -it -v $HOME/.exsat/synchronizer/.env:/app/.env -v $HOME/.exsat/synchronizer/:/root/.exsat exsatnetwork/synchronizer
```

Using Docker daemon commands
Put your password in ```$HOME/.exsat/synchronizer/password```

```shell
docker run -d -v $HOME/.exsat/synchronizer/.env:/app/.env -v $HOME/.exsat/synchronizer/:/root/.exsat --name synchronizer exsatnetwork/synchronizer  --run --pwdfile /root/.exsat/password
```

View logs
```shell
docker logs -f synchronizer
```


## Run validator

```shell
mkdir -p $HOME/.exsat/validator
curl -o $HOME/.exsat/validator/.env https://raw.githubusercontent.com/exsat-network/client_testnet/master/validator/.env.example
```

Edit your .env file
```shell
vim $HOME/.exsat/validator/.env
```

Using Docker interactive commands
```shell
docker run -it -v $HOME/.exsat/validator/.env:/app/.env -v $HOME/.exsat/validator/:/root/.exsat exsatnetwork/validator
```

Using Docker daemon commands
Put your password in ```$HOME/.exsat/validator/password```
```shell
docker run -d -v $HOME/.exsat/validator/.env:/app/.env -v $HOME/.exsat/validator/:/root/.exsat --name validator exsatnetwork/validator --run --pwdfile /root/.exsat/password
```
