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
