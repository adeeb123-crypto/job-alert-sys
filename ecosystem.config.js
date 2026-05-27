module.exports = {
  apps: [
    {
      name: 'scheduler',
      script: 'dist/index.js',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
