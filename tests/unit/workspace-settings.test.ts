import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getWorkspaceSettings,
  isWorkspaceConfigurationMap,
  resolveWorkspaceSection,
} from '../../src/config/workspace-settings.js';

describe('workspace settings', () => {
  const workspaceRoot = path.resolve('/workspace/project');
  const settings = {
    python: {
      pythonPath: '/runtimes/python/bin/python',
    },
    'language.analysis': {
      diagnosticMode: 'workspace',
    },
  };

  it('validates absolute, unambiguous root maps', () => {
    expect(isWorkspaceConfigurationMap({ [workspaceRoot]: settings })).toBe(true);
    expect(
      isWorkspaceConfigurationMap({
        [path.join(workspaceRoot, 'not-created-yet')]: settings,
      }),
    ).toBe(true);
    expect(isWorkspaceConfigurationMap({ relative: settings })).toBe(false);
    expect(isWorkspaceConfigurationMap({ [workspaceRoot]: [] })).toBe(false);
    expect(
      isWorkspaceConfigurationMap({
        [workspaceRoot]: settings,
        [`${workspaceRoot}${path.sep}.`]: settings,
      }),
    ).toBe(false);
  });

  it('rejects roots that resolve to the same canonical directory', () => {
    const testRoot = fs.mkdtempSync(
      path.join(process.cwd(), '.workspace-settings-test-'),
    );
    const canonicalRoot = path.join(testRoot, 'canonical');
    const aliasRoot = path.join(testRoot, 'alias');

    try {
      fs.mkdirSync(canonicalRoot);
      fs.symlinkSync(
        canonicalRoot,
        aliasRoot,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      expect(
        isWorkspaceConfigurationMap({
          [canonicalRoot]: settings,
          [aliasRoot]: settings,
        }),
      ).toBe(false);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when separately validated roots later converge', () => {
    const testRoot = fs.mkdtempSync(
      path.join(process.cwd(), '.workspace-settings-late-alias-test-'),
    );
    const canonicalRoot = path.join(testRoot, 'canonical');
    const firstAlias = path.join(testRoot, 'first-alias');
    const secondAlias = path.join(testRoot, 'second-alias');
    const firstSettings = { language: { mode: 'first' } };
    const secondSettings = { language: { mode: 'second' } };
    const configurations = {
      [firstAlias]: firstSettings,
      [secondAlias]: secondSettings,
    };

    try {
      expect(isWorkspaceConfigurationMap(configurations)).toBe(true);
      fs.mkdirSync(canonicalRoot);
      fs.symlinkSync(
        canonicalRoot,
        firstAlias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      fs.symlinkSync(
        canonicalRoot,
        secondAlias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      expect(getWorkspaceSettings(configurations, secondAlias)).toBeUndefined();
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('selects only the exact normalized workspace root', () => {
    const configurations = { [workspaceRoot]: settings };

    expect(getWorkspaceSettings(configurations, workspaceRoot)).toBe(settings);
    expect(
      getWorkspaceSettings(configurations, path.join(workspaceRoot, 'nested')),
    ).toBeUndefined();
    expect(
      getWorkspaceSettings(configurations, path.dirname(workspaceRoot)),
    ).toBeUndefined();
    expect(
      getWorkspaceSettings(configurations, `${workspaceRoot}-other`),
    ).toBeUndefined();
  });

  it('resolves literal and nested sections without language-specific rules', () => {
    expect(resolveWorkspaceSection(settings, 'python')).toEqual(settings.python);
    expect(resolveWorkspaceSection(settings, 'python.pythonPath')).toBe(
      '/runtimes/python/bin/python',
    );
    expect(resolveWorkspaceSection(settings, 'language.analysis')).toEqual(
      settings['language.analysis'],
    );
    expect(resolveWorkspaceSection(settings, 'missing')).toBeNull();
    expect(resolveWorkspaceSection(settings, undefined)).toBe(settings);
  });
});
