// `ng serve` → the server from source (`bun run dev`, scripts/dev.ts): every `/api` request goes to its loopback port.
import process from 'node:process';

const apiPort = process.env['SPECTANT_DEV_API_PORT'] ?? '7718';

export default {
  '/api': {
    target: `http://127.0.0.1:${apiPort}`,
    secure: false,
  },
};
