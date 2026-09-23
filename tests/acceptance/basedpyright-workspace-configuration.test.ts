import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnostic, LSPClient, LSPServerConfig } from '../../src/types.js';
import { createLSPClient } from '../../src/services/lsp-client.js';
import { pathToUri } from '../../src/utils/uri.js';

const basedPyrightCommand = process.env.BASEDPYRIGHT_COMMAND;
const pythonWithPydantic = process.env.PYTHON_WITH_PYDANTIC;
const pythonWithoutPydantic = process.env.PYTHON_WITHOUT_PYDANTIC;
const acceptanceRoot = process.env.LSP_ACCEPTANCE_ROOT;
const hasAcceptanceRuntime = Boolean(
  basedPyrightCommand &&
    pythonWithPydantic &&
    pythonWithoutPydantic &&
    acceptanceRoot,
);

async function settledDiagnostics(
  client: LSPClient,
  uri: string,
): Promise<Diagnostic[]> {
  return new Promise((resolve, reject) => {
    let latest: Diagnostic[] = [];
    let settleTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      reject(new Error(`Timed out waiting for diagnostics for ${uri}`));
    }, 15000);

    client.onDiagnostics((diagnosticUri, diagnostics) => {
      if (diagnosticUri !== uri) {
        return;
      }

      latest = diagnostics;
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(() => {
        clearTimeout(timeout);
        resolve(latest);
      }, 1000);
    });
  });
}

async function diagnosticsForWorkspace(
  client: LSPClient,
  workspaceRoot: string,
): Promise<Diagnostic[]> {
  const filePath = path.join(workspaceRoot, 'main.py');
  const uri = pathToUri(filePath);
  const content = 'import pydantic\nmodel_type = pydantic.BaseModel\n';
  await fs.writeFile(filePath, content, 'utf8');

  const diagnostics = settledDiagnostics(client, uri);
  client.didOpen({
    uri,
    languageId: 'python',
    version: 1,
    text: content,
  });
  return diagnostics;
}

describe('BasedPyright exact-root workspace configuration', () => {
  const acceptance = hasAcceptanceRuntime ? it : it.skip;

  acceptance('uses the interpreter configured for each exact workspace root', async () => {
    const firstRoot = await fs.mkdtemp(path.join(acceptanceRoot!, 'with-pydantic-'));
    const secondRoot = await fs.mkdtemp(path.join(acceptanceRoot!, 'without-pydantic-'));
    const serverConfig: LSPServerConfig = {
      id: 'python',
      extensions: ['.py', '.pyi'],
      languageIds: ['python'],
      command: basedPyrightCommand!,
      args: ['--stdio'],
      env: { PYTHONDONTWRITEBYTECODE: '1' },
      rootPatterns: ['pyproject.toml'],
      workspaceConfigurations: {
        [firstRoot]: {
          python: { pythonPath: pythonWithPydantic! },
        },
        [secondRoot]: {
          python: { pythonPath: pythonWithoutPydantic! },
        },
      },
    };
    const firstClient = createLSPClient(serverConfig, 20000);
    const secondClient = createLSPClient(serverConfig, 20000);

    try {
      await firstClient.initialize(firstRoot);
      await secondClient.initialize(secondRoot);
      const [firstDiagnostics, secondDiagnostics] = await Promise.all([
        diagnosticsForWorkspace(firstClient, firstRoot),
        diagnosticsForWorkspace(secondClient, secondRoot),
      ]);
      const isMissingPydantic = (diagnostic: Diagnostic) =>
        diagnostic.message.includes('Import "pydantic" could not be resolved');

      expect(firstDiagnostics.some(isMissingPydantic)).toBe(false);
      expect(secondDiagnostics.some(isMissingPydantic)).toBe(true);
    } finally {
      await Promise.all([firstClient.shutdown(), secondClient.shutdown()]);
      firstClient.exit();
      secondClient.exit();
      await Promise.all([
        fs.rm(firstRoot, { recursive: true, force: true }),
        fs.rm(secondRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
