import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isScopeInWorkspace } from '../../src/config/workspace-scope.js';
import { pathToUri } from '../../src/utils/uri.js';

describe('workspace scope containment', () => {
  it('accepts ordinary in-root scopes and rejects lexical siblings', () => {
    const testRoot = fs.mkdtempSync(
      path.join(process.cwd(), '.workspace-scope-basic-test-'),
    );
    const workspaceRoot = path.join(testRoot, 'workspace');

    try {
      fs.mkdirSync(workspaceRoot);
      expect(isScopeInWorkspace(undefined, workspaceRoot)).toBe(true);
      expect(isScopeInWorkspace(pathToUri(workspaceRoot), workspaceRoot)).toBe(true);
      expect(
        isScopeInWorkspace(
          pathToUri(path.join(workspaceRoot, 'src', 'not-created.ts')),
          workspaceRoot,
        ),
      ).toBe(true);
      expect(
        isScopeInWorkspace(
          pathToUri(`${workspaceRoot}-other/not-created.ts`),
          workspaceRoot,
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('rejects a missing leaf reached through an in-root symlink to outside', () => {
    const testRoot = fs.mkdtempSync(
      path.join(process.cwd(), '.workspace-scope-test-'),
    );
    const workspaceRoot = path.join(testRoot, 'workspace');
    const externalRoot = path.join(testRoot, 'external');
    const escapeLink = path.join(workspaceRoot, 'escape');

    try {
      fs.mkdirSync(workspaceRoot);
      fs.mkdirSync(externalRoot);
      fs.symlinkSync(
        externalRoot,
        escapeLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const missingExternalLeaf = path.join(escapeLink, 'not-created.py');
      expect(fs.existsSync(missingExternalLeaf)).toBe(false);
      expect(
        isScopeInWorkspace(pathToUri(missingExternalLeaf), workspaceRoot),
      ).toBe(false);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('rejects authority, decorated, malformed, and non-file URIs', () => {
    const workspaceRoot = process.cwd();
    const localFileUri = pathToUri(
      path.join(workspaceRoot, 'src', 'not-created.ts'),
    );

    expect(isScopeInWorkspace('file://src/file.ts', workspaceRoot)).toBe(false);
    expect(isScopeInWorkspace('file://remotehost/file.ts', workspaceRoot)).toBe(
      false,
    );
    expect(isScopeInWorkspace(`${localFileUri}?query=1`, workspaceRoot)).toBe(
      false,
    );
    expect(isScopeInWorkspace(`${localFileUri}#fragment`, workspaceRoot)).toBe(
      false,
    );
    expect(isScopeInWorkspace(`${localFileUri}/%00`, workspaceRoot)).toBe(false);
    expect(isScopeInWorkspace('untitled:document', workspaceRoot)).toBe(false);
    expect(isScopeInWorkspace('https://example.com/file.ts', workspaceRoot)).toBe(
      false,
    );
  });
});
