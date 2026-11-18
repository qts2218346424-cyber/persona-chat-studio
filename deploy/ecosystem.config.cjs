module.exports = {
  apps: [
    {
      name: 'star-whisper',
      script: 'server/index.js',
      cwd: '/opt/star-whisper',
      node_args: '--no-warnings',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3210',
        DISABLE_LOCAL_TTS_WORKERS: '1'
      }
    }
  ]
};
