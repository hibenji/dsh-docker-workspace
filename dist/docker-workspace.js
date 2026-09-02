import { gunzipSync } from 'node:zlib';
import chunk0 from './docker-workspace-payload/0.js';
import chunk1 from './docker-workspace-payload/1.js';
import chunk2 from './docker-workspace-payload/2.js';
import chunk3 from './docker-workspace-payload/3.js';
import chunk4 from './docker-workspace-payload/4.js';
import chunk5 from './docker-workspace-payload/5.js';

const payload = chunk0 + chunk1 + chunk2 + chunk3 + chunk4 + chunk5;
let source = gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
const replacements = new Map([
  ["'@deepseek-ai/cordis'", JSON.stringify(import.meta.resolve('@deepseek-ai/cordis'))],
  ["'@deepseek-ai/schemastery'", JSON.stringify(import.meta.resolve('@deepseek-ai/schemastery'))],
  ["'./docker-cli.js'", JSON.stringify(new URL('./docker-cli.js', import.meta.url).href)],
  ["'./config.js'", JSON.stringify(new URL('./config.js', import.meta.url).href)],
  ["'./paths.js'", JSON.stringify(new URL('./paths.js', import.meta.url).href)],
]);
for (const [from, to] of replacements) source = source.replaceAll(from, to);
source = source.replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

export const name = module.name;
export const Config = module.Config;
export const DockerWorkspaceRuntime = module.DockerWorkspaceRuntime;
export default module.default;
