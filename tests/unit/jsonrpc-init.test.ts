/**
 * Regression test for "Unknown parameter structure byName".
 *
 * vscode-jsonrpc identifies a request's parameter structure with singleton objects
 * (ParameterStructures.byName) that are compared by REFERENCE identity. If the JSON-RPC
 * connection and the LSP request types (InitializeRequest, ...) originate from two different
 * copies of vscode-jsonrpc, those singletons differ by identity and sending the `initialize`
 * request throws `Unknown parameter structure byName`, breaking EVERY language server.
 *
 * To prevent this, the connection primitives MUST be imported from the SAME package that
 * defines the request types — `vscode-languageserver-protocol/node` — exactly as
 * src/services/lsp-client.ts does. This test mirrors that import and asserts that an
 * `initialize` request serializes without throwing.
 */
import { PassThrough } from 'node:stream';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node';
import { InitializeRequest } from 'vscode-languageserver-protocol';

describe('JSON-RPC initialize parameter structure', () => {
  it('sends InitializeRequest without an identity mismatch on ParameterStructures', () => {
    const connection = createMessageConnection(
      new StreamMessageReader(new PassThrough()),
      new StreamMessageWriter(new PassThrough())
    );
    connection.listen();
    let pending: Promise<unknown> | undefined;
    try {
      // computeMessageParams runs synchronously inside sendRequest; a mismatched
      // ParameterStructures.byName singleton throws here ("Unknown parameter structure byName").
      expect(() => {
        pending = connection.sendRequest(InitializeRequest.type, {
          processId: process.pid,
          rootUri: null,
          capabilities: {},
        });
      }).not.toThrow();
    } finally {
      // No server ever responds; dispose() rejects the pending request — swallow it.
      pending?.catch(() => {});
      connection.dispose();
    }
  });
});
