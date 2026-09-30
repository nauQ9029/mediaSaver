import app from './app.js';
import { startMultipartCleanupWorker } from './services/multipartCleanup.js';

const port = Number(process.env.PORT) || 5000;

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
  startMultipartCleanupWorker();
});
