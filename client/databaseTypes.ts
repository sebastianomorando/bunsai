export type DatabaseColumn = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  generated: boolean;
  primaryKey: boolean;
  sensitive: boolean;
  editable: boolean;
  references: { table: string; column: string; schema: string }[];
};
export type DatabaseTable = {
  name: string;
  kind: 'table' | 'view';
  columns: DatabaseColumn[];
  primaryKey: string[];
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  protected: boolean;
};
export type DatabaseRow = {
  values: Record<string, string | null>;
  key: Record<string, string> | null;
  version: string | null;
  truncated: string[];
};
export type DatabaseRows = {
  rows: DatabaseRow[];
  page: number;
  limit: number;
  hasMore: boolean;
  sortBy: string;
  direction: 'asc' | 'desc';
};
export type DatabaseQuery = {
  page: number;
  limit: number;
  sortBy: string;
  direction: 'asc' | 'desc';
  filterColumn: string;
  filterOperator: 'equals' | 'contains' | 'null' | 'notnull';
  filterValue: string;
};
