// Tool handlers
export { handleGotoDefinition, handleGotoTypeDefinition } from './definition.js';
export { handleFindReferences, handleFindImplementations } from './references.js';
export { handleHover, handleSignatureHelp } from './hover.js';
export { handleDocumentSymbols, handleWorkspaceSymbols } from './symbols.js';
export { handleDiagnostics } from './diagnostics.js';
export { handleCompletions } from './completion.js';
export { handleRename } from './rename.js';
export { handleServerStatus, handleStartServer, handleStopServer } from './server.js';
export { handleCodeActions } from './code-actions.js';
export { handleCallHierarchy } from './call-hierarchy.js';
export { handleTypeHierarchy } from './type-hierarchy.js';
export { handleFormatDocument } from './formatting.js';
export { handleSmartSearch } from './smart-search.js';

// Context
export { setToolContext, getToolContext } from './context.js';

// Utilities
export {
  prepareFile,
  locationToResult,
  locationLinkToResult,
  convertLocations,
  getSymbolKindName,
  getCompletionKindName,
  getDiagnosticSeverityName,
  toPosition,
  matchesSymbolKind,
} from './utils.js';
