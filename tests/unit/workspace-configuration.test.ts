import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ConfigurationRequest } from 'vscode-languageserver-protocol';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node';
import { WorkspaceConfigurationBridge } from '../../src/services/workspace-configuration.js';
import { pathToUri } from '../../src/utils/uri.js';

describe('WorkspaceConfigurationBridge', () => {
  it('serves scoped settings over in-memory JSON-RPC', async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const clientConnection = createMessageConnection(
      new StreamMessageReader(serverToClient),
      new StreamMessageWriter(clientToServer),
    );
    const serverConnection = createMessageConnection(
      new StreamMessageReader(clientToServer),
      new StreamMessageWriter(serverToClient),
    );
    const workspaceRoot = path.resolve('/workspace/project');
    const settings = {
      python: {
        pythonPath: '/runtimes/python/bin/python',
      },
    };
    const bridge = new WorkspaceConfigurationBridge(workspaceRoot, settings);

    bridge.register(clientConnection);
    clientConnection.listen();
    serverConnection.listen();

    try {
      await expect(
        serverConnection.sendRequest(ConfigurationRequest.type, {
          items: [
            {
              scopeUri: pathToUri(path.join(workspaceRoot, 'src', 'main.py')),
              section: 'python',
            },
            {
              scopeUri: pathToUri('/workspace/other/main.py'),
              section: 'python',
            },
            { section: 'missing' },
          ],
        }),
      ).resolves.toEqual([settings.python, null, null]);
    } finally {
      serverConnection.dispose();
      clientConnection.dispose();
    }
  });
});
