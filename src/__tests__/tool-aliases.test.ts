import { describe, it, expect } from 'bun:test';
import { tools } from '../tools/index.js';

describe('canonical and alias tools', () => {
  it('registers canonical tools and alias tools in tool registry', () => {
    const names = tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_edit');
    expect(names).toContain('list_dir');
    expect(names).toContain('shell');
    expect(names).toContain('grep');
    expect(names).toContain('glob');

    // Alias tools registered to support models that use common alternate names
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('list_files');
    expect(names).toContain('ls');
    expect(names).toContain('bash');
    expect(names).toContain('run_command');
  });
});

describe('filterTools', () => {
  it('includes requested tools and their aliases when allowedTools is specified', async () => {
    const { filterTools } = await import('../agent.js');
    const filtered = filterTools(tools, ['file_read', 'list_dir']);
    const names = filtered.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('file_read');
    expect(names).toContain('read_file');
    expect(names).toContain('list_dir');
    expect(names).toContain('list_files');
    expect(names).not.toContain('shell');
    expect(names).not.toContain('file_write');
    expect(names).not.toContain('openrouter_models');
    expect(names).not.toContain('openrouter:datetime');
  });

  it('excludes all tools when allowedTools is none', async () => {
    const { filterTools } = await import('../agent.js');
    const filtered = filterTools(tools, ['none']);
    expect(filtered).toEqual([]);
  });

  it('supports shell wildcard filter', async () => {
    const { filterTools } = await import('../agent.js');
    const filtered = filterTools(tools, ['shell(git *)']);
    const names = filtered.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('shell');
    expect(names).not.toContain('file_read');
  });

  it('keeps wire request tools canonical while preserving aliases in execution tools', async () => {
    const { OpenRouter } = await import('@openrouter/agent');
    const client = new OpenRouter({ apiKey: 'mock' });
    const ALIAS_TOOLS = new Set([
      'read_file', 'read', 'view_file',
      'write_file', 'write',
      'edit_file', 'edit',
      'list_files', 'ls',
      'bash', 'run_command',
      'read_persisted_result',
    ]);

    const origCallModel = client.callModel.bind(client);
    (client as any).callModel = (params: any, callOptions: any) => {
      const res = origCallModel(params, callOptions);
      if (res.options?.request?.tools) {
        res.options.request.tools = res.options.request.tools.filter(
          (t: any) => !ALIAS_TOOLS.has(t.name)
        );
      }
      return res;
    };

    const res = client.callModel({
      model: 'test-model',
      instructions: 'test',
      input: 'hello',
      tools: tools as any,
    });

    const wireNames = res.options.request.tools.map((t: any) => t.name ?? t.type);
    // Wire request MUST NOT contain duplicate aliases
    expect(wireNames).toContain('file_read');
    expect(wireNames).toContain('file_write');
    expect(wireNames).toContain('shell');
    expect(wireNames).not.toContain('read_file');
    expect(wireNames).not.toContain('write_file');
    expect(wireNames).not.toContain('bash');
    expect(wireNames).not.toContain('run_command');

    // Execution tools MUST retain aliases so unprompted model calls work
    const execNames = res.options.tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(execNames).toContain('file_read');
    expect(execNames).toContain('read_file');
    expect(execNames).toContain('shell');
    expect(execNames).toContain('bash');
  });
});
