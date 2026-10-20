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
});
