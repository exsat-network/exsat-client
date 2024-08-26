module.exports = {
  apps: [
    {
      name: 'validator',
      script: 'ts-node',
      args: '-r tsconfig-paths/register src/validator/index.ts',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
    }
  ]
};
