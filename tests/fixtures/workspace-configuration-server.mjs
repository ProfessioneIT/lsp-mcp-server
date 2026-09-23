import { isDeepStrictEqual } from 'node:util';
import {
  ConfigurationRequest,
  InitializeRequest,
  InitializedNotification,
} from 'vscode-languageserver-protocol';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node';

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const expectedConfiguration =
  process.env.TEST_EXPECT_WORKSPACE_CONFIGURATION === 'true';
const expectedInitializationOptions = JSON.parse(
  process.env.TEST_EXPECT_INITIALIZATION_OPTIONS ?? 'null',
);
const expectedSettings = JSON.parse(process.env.TEST_EXPECT_SETTINGS ?? 'null');
let initializeParams;

connection.onRequest(InitializeRequest.type, (params) => {
  initializeParams = params;
  return { capabilities: {} };
});

connection.onNotification(InitializedNotification.type, async () => {
  let exitCode = 0;

  try {
    const advertisedConfiguration =
      initializeParams?.capabilities.workspace?.configuration === true;
    if (advertisedConfiguration !== expectedConfiguration) {
      exitCode = 2;
    } else if (
      !isDeepStrictEqual(
        initializeParams?.initializationOptions,
        expectedInitializationOptions,
      )
    ) {
      exitCode = 3;
    } else if (expectedConfiguration) {
      const rootUri = initializeParams?.rootUri;
      if (typeof rootUri !== 'string') {
        exitCode = 4;
      } else {
        const response = await connection.sendRequest(ConfigurationRequest.type, {
          items: [
            { scopeUri: `${rootUri}/src/file.ts`, section: 'language' },
            { scopeUri: rootUri, section: 'missing' },
          ],
        });
        if (!isDeepStrictEqual(response, [expectedSettings.language, null])) {
          exitCode = 5;
        }
      }
    }
  } catch {
    exitCode = 6;
  } finally {
    connection.dispose();
    process.exit(exitCode);
  }
});

connection.listen();
