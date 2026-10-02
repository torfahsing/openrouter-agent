import { describe, it, expect } from 'bun:test';
import { tools } from '../tools/index.js';

describe('tool aliases', () => {
  it('registers read_file, read, and view_file aliases for file_read', () => {
    const names = tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('file_read');
    expect(names).toContain('read_file');
    expect(names).toContain('read');
    expect(names).toContain('view_file');
  });

  it('registers write_file and write aliases for file_write', () => {
    const names = tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('file_write');
    expect(names).toContain('write_file');
    expect(names).toContain('write');
  });

  it('registers edit_file and edit aliases for file_edit', () => {
    const names = tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('file_edit');
    expect(names).toContain('edit_file');
    expect(names).toContain('edit');
  });

  it('registers list_files and ls aliases for list_dir', () => {
    const names = tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('list_dir');
    expect(names).toContain('list_files');
    expect(names).toContain('ls');
  });

  it('registers bash and run_command aliases for shell', () => {
    const names = tools.map((t: any) => t.function?.name ?? t.config?.type);
    expect(names).toContain('shell');
    expect(names).toContain('bash');
    expect(names).toContain('run_command');
  });
});
