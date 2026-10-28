import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { executeFileEdit } from '../tools/file-edit.js';
import { executeFileWrite } from '../tools/file-write.js';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resilient file tools', () => {
  const testFile = join(tmpdir(), `test-file-tools-${Date.now()}.txt`);

  beforeEach(() => {
    writeFileSync(testFile, 'hello world\nline 2\nline 3\n', 'utf-8');
  });

  afterEach(() => {
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  it('supports file_write with content', async () => {
    const res = await executeFileWrite({ path: testFile, content: 'updated with content' });
    expect(res.written).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe('updated with content');
  });

  it('supports file_write with contents alias', async () => {
    const res = await executeFileWrite({ path: testFile, contents: 'updated with contents' });
    expect(res.written).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe('updated with contents');
  });

  it('supports file_edit with standard edits array', async () => {
    const res = await executeFileEdit({
      path: testFile,
      edits: [{ old_text: 'hello world', new_text: 'hello universe' }],
    });
    expect(res.edited).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toContain('hello universe');
  });

  it('supports file_edit with camelCase edits array', async () => {
    const res = await executeFileEdit({
      path: testFile,
      edits: [{ oldText: 'line 2', newText: 'line two' }],
    });
    expect(res.edited).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toContain('line two');
  });

  it('supports file_edit with target/replacement aliases', async () => {
    const res = await executeFileEdit({
      path: testFile,
      edits: [{ target: 'line 3', replacement: 'line three' }],
    });
    expect(res.edited).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toContain('line three');
  });

  it('supports file_edit with flat top-level parameters', async () => {
    const res = await executeFileEdit({
      path: testFile,
      old_text: 'hello world',
      new_text: 'flat edit worked',
    });
    expect(res.edited).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toContain('flat edit worked');
  });

  it('supports file_edit with flat camelCase top-level parameters', async () => {
    const res = await executeFileEdit({
      path: testFile,
      oldText: 'line 2',
      newText: 'flat camelCase worked',
    });
    expect(res.edited).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toContain('flat camelCase worked');
  });
});
