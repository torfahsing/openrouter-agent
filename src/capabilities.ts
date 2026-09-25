export interface AgentToolCapability {
  id: string;
  name: string;
  category: 'read' | 'write' | 'execute' | 'search' | 'web' | 'metadata';
  readOnly: boolean;
  description: string;
}

export interface AgentCategoryCapability {
  id: string;
  name: string;
  default: boolean;
}

export interface AgentFeatures {
  models?: boolean;
  quota?: boolean;
  streaming?: boolean;
  sessions?: boolean;
}

export interface AgentCapabilities {
  name: string;
  version: string;
  protocol: string;
  description: string;
  tools: AgentToolCapability[];
  categories: AgentCategoryCapability[];
  supportedModels?: string[];
  features?: AgentFeatures;
}

export const OPENROUTER_AGENT_CAPABILITIES: AgentCapabilities = {
  name: 'openrouter-agent',
  version: '0.1.0',
  protocol: 'specflow-agent-v1',
  description: 'Headless agent powered by OpenRouter models with client-side tool execution',
  tools: [
    {
      id: 'file_read',
      name: 'Read File',
      category: 'read',
      readOnly: true,
      description: 'Read file contents with line range support',
    },
    {
      id: 'file_write',
      name: 'Write File',
      category: 'write',
      readOnly: false,
      description: 'Create or overwrite files',
    },
    {
      id: 'file_edit',
      name: 'Edit File',
      category: 'write',
      readOnly: false,
      description: 'Targeted search-and-replace editing in files',
    },
    {
      id: 'shell',
      name: 'Bash Shell',
      category: 'execute',
      readOnly: false,
      description: 'Execute shell commands in current working directory',
    },
    {
      id: 'grep',
      name: 'Grep Search',
      category: 'search',
      readOnly: true,
      description: 'Fast regex search across files',
    },
    {
      id: 'glob',
      name: 'Glob Search',
      category: 'search',
      readOnly: true,
      description: 'Find files matching glob pattern',
    },
    {
      id: 'list_dir',
      name: 'List Directory',
      category: 'read',
      readOnly: true,
      description: 'List directory contents',
    },
    {
      id: 'openrouter_models',
      name: 'OpenRouter Models',
      category: 'metadata',
      readOnly: true,
      description: 'Search available OpenRouter models and real-time pricing',
    },
    {
      id: 'web_search',
      name: 'Web Search',
      category: 'web',
      readOnly: true,
      description: 'Search the web using OpenRouter server-side tool',
    },
    {
      id: 'web_fetch',
      name: 'Web Fetch',
      category: 'web',
      readOnly: true,
      description: 'Fetch web page content using OpenRouter server-side tool',
    },
    {
      id: 'datetime',
      name: 'Date & Time',
      category: 'metadata',
      readOnly: true,
      description: 'Get current UTC datetime',
    },
  ],
  categories: [
    { id: 'read', name: 'File Reading', default: true },
    { id: 'search', name: 'Code Search', default: true },
    { id: 'write', name: 'File Modification', default: true },
    { id: 'execute', name: 'Shell Execution', default: true },
    { id: 'web', name: 'Web Access', default: false },
    { id: 'metadata', name: 'Metadata & Helpers', default: true },
  ],
  supportedModels: [],
  features: {
    models: true,
    quota: false,
    sessions: true,
  },
};
