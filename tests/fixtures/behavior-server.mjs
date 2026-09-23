// Minimal LSP server whose behavior is selected by FIXTURE_MODE:
//   silent   - never answers initialize
//   crash    - exits immediately
//   loading  - after didOpen, "loads the project" for FIXTURE_LOAD_MS; while
//              loading, references return only the local result. Loading is
//              reported with window/workDoneProgress when the client supports it.
// With FIXTURE_DIAG_DELAY_MS set, every didOpen/didChange publishes one diagnostic
// whose message is the document text, after that delay.
import {
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  PublishDiagnosticsNotification,
  InitializeRequest,
  ReferencesRequest,
  WorkDoneProgress,
  WorkDoneProgressCreateRequest,
} from 'vscode-languageserver-protocol';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node';

const mode = process.env.FIXTURE_MODE ?? 'loading';
if (mode === 'crash') {
  process.exit(3);
}

const loadMs = Number(process.env.FIXTURE_LOAD_MS ?? '800');
const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

let progressSupported = false;
let loaded = false;

connection.onRequest(InitializeRequest.type, (params) => {
  if (mode === 'silent') {
    return new Promise(() => {});
  }
  progressSupported = params.capabilities.window?.workDoneProgress === true;
  return { capabilities: { referencesProvider: true } };
});

const diagDelayMs = process.env.FIXTURE_DIAG_DELAY_MS ? Number(process.env.FIXTURE_DIAG_DELAY_MS) : null;
function publishLater(uri, text) {
  if (diagDelayMs === null) return;
  setTimeout(() => {
    connection.sendNotification(PublishDiagnosticsNotification.type, {
      uri,
      diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: text, severity: 1 }],
    });
  }, diagDelayMs);
}

connection.onNotification(DidChangeTextDocumentNotification.type, (params) => {
  publishLater(params.textDocument.uri, params.contentChanges.at(-1).text);
});

connection.onNotification(DidOpenTextDocumentNotification.type, async (params) => {
  publishLater(params.textDocument.uri, params.textDocument.text);
  if (loaded || process.env.FIXTURE_NO_LOAD === 'true') {
    loaded = true;
    return;
  }
  const token = 'project-load';
  if (progressSupported) {
    await connection.sendRequest(WorkDoneProgressCreateRequest.type, { token });
    connection.sendProgress(WorkDoneProgress.type, token, { kind: 'begin', title: 'Loading project' });
  }
  setTimeout(() => {
    loaded = true;
    if (progressSupported) {
      connection.sendProgress(WorkDoneProgress.type, token, { kind: 'end' });
    }
  }, loadMs);
});

connection.onRequest(ReferencesRequest.type, (params) => {
  const here = { uri: params.textDocument.uri, range: { start: params.position, end: params.position } };
  const elsewhere = { uri: params.textDocument.uri.replace(/[^/]+$/, 'other.fixture'), range: here.range };
  return loaded ? [here, elsewhere] : [here];
});

connection.listen();
