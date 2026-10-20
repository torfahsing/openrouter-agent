import { serverTool } from '@openrouter/agent';
import { fileReadTool, readFileTool, readTool, viewFileTool } from './file-read.js';
import { fileWriteTool, writeFileTool, writeTool } from './file-write.js';
import { fileEditTool, editFileTool, editTool } from './file-edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listDirTool, listFilesTool, lsTool } from './list-dir.js';
import { shellTool, bashTool, runCommandTool } from './shell.js';
import { OFFLOAD_DEFAULTS } from '../tool-offload.js';
import { createReadPersistedResultTool } from './read-persisted-result.js';
import { openrouterModelsTool } from './models.js';

export const tools = [
  // User-defined local tools (executed client-side)
  fileReadTool,
  readFileTool,
  readTool,
  viewFileTool,
  fileWriteTool,
  writeFileTool,
  writeTool,
  fileEditTool,
  editFileTool,
  editTool,
  globTool,
  listDirTool,
  listFilesTool,
  lsTool,
  grepTool,
  shellTool,
  bashTool,
  runCommandTool,
  openrouterModelsTool,
  createReadPersistedResultTool(OFFLOAD_DEFAULTS.storageDir),

  // OpenRouter Server-side tools (executed by OpenRouter)
  serverTool({ type: 'openrouter:web_search' }),
  serverTool({ type: 'openrouter:web_fetch' }),
  serverTool({ type: 'openrouter:datetime', parameters: { timezone: 'UTC' } }),
] as const;

