import { serverTool } from '@openrouter/agent';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listDirTool } from './list-dir.js';
import { shellTool } from './shell.js';
import { OFFLOAD_DEFAULTS } from '../tool-offload.js';
import { createReadPersistedResultTool } from './read-persisted-result.js';
import { openrouterModelsTool } from './models.js';

export const tools = [
  // User-defined local tools (executed client-side)
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  globTool,
  listDirTool,
  grepTool,
  shellTool,
  openrouterModelsTool,
  createReadPersistedResultTool(OFFLOAD_DEFAULTS.storageDir),

  // OpenRouter Server-side tools (executed by OpenRouter)
  serverTool({ type: 'openrouter:web_search' }),
  serverTool({ type: 'openrouter:web_fetch' }),
  serverTool({ type: 'openrouter:datetime', parameters: { timezone: 'UTC' } }),
] as const;
