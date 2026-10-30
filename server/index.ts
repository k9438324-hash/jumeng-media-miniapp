import { loadConfig } from './config.js';
import { createApplication } from './app.js';
const config = loadConfig();
const app = createApplication(config);
app.server.listen(config.port, config.host, () => {
  const address = app.server.address();
  console.log(`聚梦传媒服务已启动 http://${config.host}:${typeof address === 'object' && address ? address.port : config.port} · 身份=${config.authMode} · AI=${config.aiMode}`);
});
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void app.shutdown().then(()=>process.exit(0)); });
