module.exports = {
  apps: [
    {
      name: 'synchronizer',
      script: 'dist/synchronizer/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
    },
    {
      name: 'validator',
      script: 'dist/validator/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
