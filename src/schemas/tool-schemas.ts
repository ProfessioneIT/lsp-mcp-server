import { z } from 'zod';

// ============================================================================
// Common Schemas
// ============================================================================

const FilePathSchema = z.string()
  .min(1)
  .describe('Absolute path to the source file');

const LineSchema = z.number()
  .int()
  .min(1)
  .describe('Line number (1-indexed)');

const ColumnSchema = z.number()
  .int()
  .min(1)
  .describe('Column number (1-indexed)');

// ============================================================================
// Tool Input Schemas
// ============================================================================

export const GotoDefinitionSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
}).strict();

export const GotoTypeDefinitionSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
}).strict();

export const FindReferencesSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  include_declaration: z.boolean()
    .default(true)
    .describe('Whether to include the declaration in results'),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum number of results to return'),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of results to skip (for pagination)'),
}).strict();

export const FindImplementationsSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Maximum number of results'),
}).strict();

export const HoverSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
}).strict();

export const SignatureHelpSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
}).strict();

export const DocumentSymbolsSchema = z.object({
  file_path: FilePathSchema,
}).strict();

export const WorkspaceSymbolsSchema = z.object({
  query: z.string()
    .min(1)
    .describe('Search query to match symbol names (supports fuzzy matching)'),
  kinds: z.array(z.enum([
    'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property',
    'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable',
    'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key',
    'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter',
  ]))
    .optional()
    .describe('Filter results to specific symbol kinds'),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Maximum number of results'),
}).strict();

export const DiagnosticsSchema = z.object({
  file_path: FilePathSchema,
  severity_filter: z.enum(['all', 'error', 'warning', 'info', 'hint'])
    .default('all')
    .describe('Filter diagnostics by minimum severity'),
}).strict();

export const CompletionsSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  limit: z.number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Maximum number of suggestions'),
}).strict();

export const RenameSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  new_name: z.string()
    .min(1)
    .describe('New name for the symbol'),
  dry_run: z.boolean()
    .default(true)
    .describe('If true, only preview changes without applying. If false, apply changes to files.'),
}).strict();

export const ServerStatusSchema = z.object({
  server_id: z.string()
    .optional()
    .describe('Specific server ID to check, or omit for all servers'),
}).strict();

export const StartServerSchema = z.object({
  server_id: z.string()
    .describe("Server ID from configuration (e.g., 'typescript', 'python')"),
  workspace_root: z.string()
    .describe('Absolute path to the workspace/project root'),
}).strict();

export const StopServerSchema = z.object({
  server_id: z.string()
    .describe("Server ID from configuration (e.g., 'typescript', 'python')"),
  workspace_root: z.string()
    .optional()
    .describe('Workspace root to stop server for. If omitted, stops all instances of this server type.'),
}).strict();

// ============================================================================
// Code Actions Schema
// ============================================================================

export const CodeActionsSchema = z.object({
  file_path: FilePathSchema,
  start_line: LineSchema.describe('Start line of the range (1-indexed)'),
  start_column: ColumnSchema.describe('Start column of the range (1-indexed)'),
  end_line: z.number()
    .int()
    .min(1)
    .optional()
    .describe('End line of the range (1-indexed). Defaults to start_line.'),
  end_column: z.number()
    .int()
    .min(1)
    .optional()
    .describe('End column of the range (1-indexed). Defaults to start_column.'),
  kinds: z.array(z.enum([
    'quickfix',
    'refactor',
    'refactor.extract',
    'refactor.inline',
    'refactor.rewrite',
    'source',
    'source.organizeImports',
    'source.fixAll',
  ]))
    .optional()
    .describe('Filter actions by kind (e.g., "quickfix", "refactor.extract")'),
}).strict();

// ============================================================================
// Call Hierarchy Schema
// ============================================================================

export const CallHierarchySchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  direction: z.enum(['incoming', 'outgoing', 'both'])
    .default('both')
    .describe('Direction of calls to retrieve: incoming (callers), outgoing (callees), or both'),
}).strict();

// ============================================================================
// Type Hierarchy Schema
// ============================================================================

export const TypeHierarchySchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  direction: z.enum(['supertypes', 'subtypes', 'both'])
    .default('both')
    .describe('Direction of hierarchy: supertypes (parents), subtypes (children), or both'),
}).strict();

// ============================================================================
// Format Document Schema
// ============================================================================

export const FormatDocumentSchema = z.object({
  file_path: FilePathSchema,
  tab_size: z.number()
    .int()
    .min(1)
    .max(8)
    .default(2)
    .describe('Size of a tab in spaces'),
  insert_spaces: z.boolean()
    .default(true)
    .describe('Prefer spaces over tabs'),
  apply: z.boolean()
    .default(false)
    .describe('If true, apply formatting changes to the file. If false, only preview changes.'),
}).strict();

// ============================================================================
// Smart Search Schema
// ============================================================================

export const SmartSearchSchema = z.object({
  file_path: FilePathSchema,
  line: LineSchema,
  column: ColumnSchema,
  include: z.array(z.enum([
    'definition',
    'references',
    'hover',
    'implementations',
    'incoming_calls',
    'outgoing_calls',
  ]))
    .default(['definition', 'references', 'hover'])
    .describe('What information to include in the search results'),
  references_limit: z.number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum number of references to include'),
}).strict();

// ============================================================================
// Type Exports
// ============================================================================

export type GotoDefinitionInput = z.infer<typeof GotoDefinitionSchema>;
export type GotoTypeDefinitionInput = z.infer<typeof GotoTypeDefinitionSchema>;
export type FindReferencesInput = z.infer<typeof FindReferencesSchema>;
export type FindImplementationsInput = z.infer<typeof FindImplementationsSchema>;
export type HoverInput = z.infer<typeof HoverSchema>;
export type SignatureHelpInput = z.infer<typeof SignatureHelpSchema>;
export type DocumentSymbolsInput = z.infer<typeof DocumentSymbolsSchema>;
export type WorkspaceSymbolsInput = z.infer<typeof WorkspaceSymbolsSchema>;
export type DiagnosticsInput = z.infer<typeof DiagnosticsSchema>;
export type CompletionsInput = z.infer<typeof CompletionsSchema>;
export type RenameInput = z.infer<typeof RenameSchema>;
export type ServerStatusInput = z.infer<typeof ServerStatusSchema>;
export type StartServerInput = z.infer<typeof StartServerSchema>;
export type StopServerInput = z.infer<typeof StopServerSchema>;
export type CodeActionsInput = z.infer<typeof CodeActionsSchema>;
export type CallHierarchyInput = z.infer<typeof CallHierarchySchema>;
export type TypeHierarchyInput = z.infer<typeof TypeHierarchySchema>;
export type FormatDocumentInput = z.infer<typeof FormatDocumentSchema>;
export type SmartSearchInput = z.infer<typeof SmartSearchSchema>;
