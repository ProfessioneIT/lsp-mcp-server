import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLSPClient } from '../../src/services/lsp-client.js';
import type {
  LSPClient,
  LSPServerConfig,
  WorkspaceConfigurationMap,
} from '../../src/types.js';

const fixturePath = fileURLToPath(
  new URL('../fixtures/workspace-configuration-server.mjs', import.meta.url),
);
const initializationOptions = {
  transport: { sentOnlyDuringInitialize: true },
};
const settings = {
  language: { analysisMode: 'workspace' },
};

function waitForExit(client: LSPClient): {
  result: Promise<number | null | 'timeout'>;
  cancelTimeout: () => void;
} {
  let timeout: NodeJS.Timeout;
  const result = new Promise<number | null | 'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), 5000);
    client.onExit((code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  return {
    result,
    cancelTimeout: () => clearTimeout(timeout),
  };
}

async function runFixture(
  workspaceRoot: string,
  workspaceConfigurations: WorkspaceConfigurationMap,
  expectedConfiguration: boolean,
): Promise<number | null | 'timeout'> {
  const config: LSPServerConfig = {
    id: 'workspace-configuration-fixture',
    extensions: ['.fixture'],
    languageIds: ['fixture'],
    command: process.execPath,
    args: [fixturePath],
    initializationOptions,
    workspaceConfigurations,
    env: {
      TEST_EXPECT_WORKSPACE_CONFIGURATION: String(expectedConfiguration),
      TEST_EXPECT_INITIALIZATION_OPTIONS: JSON.stringify(initializationOptions),
      TEST_EXPECT_SETTINGS: JSON.stringify(settings),
    },
  };
  const client = createLSPClient(config, 5000);
  const exited = waitForExit(client);

  try {
    await client.initialize(workspaceRoot);
    return await exited.result;
  } finally {
    exited.cancelTimeout();
    client.exit();
  }
}

describe('LSPClient workspace configuration integration', () => {
  const workspaceRoot = process.cwd();

  it('advertises and serves configuration for an exact root', async () => {
    await expect(
      runFixture(
        workspaceRoot,
        { [workspaceRoot]: settings },
        true,
      ),
    ).resolves.toBe(0);
  });

  it('keeps initialization options but omits configuration for a non-match', async () => {
    await expect(
      runFixture(
        workspaceRoot,
        { [path.join(workspaceRoot, 'not-the-server-root')]: settings },
        false,
      ),
    ).resolves.toBe(0);
  });
});
