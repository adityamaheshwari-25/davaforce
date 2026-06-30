"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  RefreshCw,
  Table2,
} from "lucide-react";
import { WorkspaceTopNav } from "@/components/shell/workspace-top-nav";
import { WorkforceParticleCanvas } from "@/components/workforce-particle-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getStoredWorkforceIdentity,
  loadSchemaValidation,
  type WorkforceSchemaValidationDataset,
  type WorkforceSchemaValidationTable,
} from "@/lib/workforce-schema-validation";

type HeaderEdits = Record<string, Record<string, string>>;

const INTERNAL_VALIDATION_TABLES = new Set(["ImportBatch", "RawSheetRow"]);

const visibleValidationTables = (tables: WorkforceSchemaValidationTable[]) =>
  tables.filter((table) => !INTERNAL_VALIDATION_TABLES.has(table.tableName));

const cellText = (value: string | undefined) => value ?? "";

const tableEditState = (tables: WorkforceSchemaValidationTable[]) =>
  Object.fromEntries(
    tables.map((table) => [
      table.tableName,
      Object.fromEntries(table.columns.map((column) => [column.columnName, column.displayName])),
    ]),
  ) as HeaderEdits;

export default function ValidatePage() {
  const router = useRouter();
  const [dataset, setDataset] = useState<WorkforceSchemaValidationDataset | null>(null);
  const [tables, setTables] = useState<WorkforceSchemaValidationTable[]>([]);
  const [headerEdits, setHeaderEdits] = useState<HeaderEdits>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedTable = tables[selectedIndex] ?? null;
  const sourceName = dataset?.originalFileName || dataset?.label || "normalized dataset";

  const editedHeaderCount = useMemo(
    () =>
      tables.reduce(
        (count, table) =>
          count +
          table.columns.filter((column) => {
            const value = headerEdits[table.tableName]?.[column.columnName] ?? column.displayName;
            return value.trim() && value.trim() !== column.columnName;
          }).length,
        0,
      ),
    [headerEdits, tables],
  );

  const loadValidation = async () => {
    setIsLoading(true);
    setError("");
    try {
      const { userId, datasetId } = getStoredWorkforceIdentity();
      if (!userId) {
        router.replace("/");
        return;
      }
      if (!datasetId) {
        router.replace("/?action=upload");
        return;
      }

      const payload = await loadSchemaValidation(userId, datasetId);
      if (payload.validation.status === "validated") {
        router.replace("/ask");
        return;
      }

      const visibleTables = visibleValidationTables(payload.tables);
      setDataset(payload.dataset);
      setTables(visibleTables);
      setHeaderEdits(tableEditState(visibleTables));
      setSelectedIndex(0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load schema validation.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadValidation();
  }, []);

  const selectTable = (tableName: string) => {
    const nextIndex = tables.findIndex((table) => table.tableName === tableName);
    if (nextIndex < 0 || nextIndex === selectedIndex) return;

    setSelectedIndex(nextIndex);
  };

  const moveTable = (direction: 1 | -1) => {
    if (!tables.length) return;
    const nextIndex = (selectedIndex + direction + tables.length) % tables.length;
    setSelectedIndex(nextIndex);
  };

  const updateHeader = (tableName: string, columnName: string, value: string) => {
    setHeaderEdits((current) => ({
      ...current,
      [tableName]: {
        ...(current[tableName] ?? {}),
        [columnName]: value,
      },
    }));
  };

  const validateHeaders = async () => {
    const { userId, datasetId } = getStoredWorkforceIdentity();
    if (!userId || !datasetId || isSaving) return;

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/workforce-datasets/schema-validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          datasetId,
          tables: tables.map((table) => ({
            tableName: table.tableName,
            columns: table.columns.map((column) => ({
              columnName: column.columnName,
              displayName: headerEdits[table.tableName]?.[column.columnName] ?? column.displayName,
            })),
          })),
        }),
      });
      const payload = (await response.json()) as { status: "success" | "failure"; error?: string };
      if (response.status === 409) {
        router.replace("/ask");
        return;
      }
      if (!response.ok || payload.status !== "success") {
        throw new Error(payload.error ?? "Failed to validate schema.");
      }

      window.localStorage.setItem("workforceDatasetSchemaValidated", datasetId);
      router.push("/ask");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to validate schema.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--home-bg)] text-[var(--home-text)] transition-colors duration-300">
      <WorkforceParticleCanvas />
      <WorkspaceTopNav />

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[92rem] flex-col px-4 pb-5 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              <Database className="h-4 w-4" />
              Schema validation
            </div>
            <h1 className="mt-2 truncate font-display text-3xl font-semibold text-[var(--home-text)]">
              {sourceName}
            </h1>
          </div>
          <Button
            type="button"
            className="h-11 rounded-lg bg-brand px-5 text-sm font-semibold text-brand-foreground hover:bg-brand/90"
            disabled={isLoading || isSaving || !tables.length}
            onClick={validateHeaders}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Validate
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex min-h-[28rem] items-center justify-center rounded-2xl border border-[var(--home-border)] bg-[var(--home-panel)] shadow-2xl shadow-black/10 backdrop-blur">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-brand/30 bg-brand/10 p-5 text-sm text-brand shadow-2xl shadow-black/10 backdrop-blur">
            <div>{error}</div>
            <Button
              type="button"
              variant="outline"
              className="mt-4 border-[var(--home-border)] bg-[var(--home-panel)] text-[var(--home-text)] hover:bg-[var(--home-soft)]"
              onClick={() => void loadValidation()}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="min-h-0 rounded-2xl border border-[var(--home-border)] bg-[var(--home-panel)] p-3 shadow-2xl shadow-black/10 backdrop-blur">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2">
                  <div className="font-display text-xl font-semibold">{tables.length}</div>
                  <div className="text-[11px] text-[var(--home-muted)]">Tables</div>
                </div>
                <div className="rounded-lg border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2">
                  <div className="font-display text-xl font-semibold">
                    {tables.reduce((count, table) => count + table.columns.length, 0)}
                  </div>
                  <div className="text-[11px] text-[var(--home-muted)]">Headers</div>
                </div>
                <div className="rounded-lg border border-[var(--home-border)] bg-[var(--home-soft)] px-3 py-2">
                  <div className="font-display text-xl font-semibold">{editedHeaderCount}</div>
                  <div className="text-[11px] text-[var(--home-muted)]">Edited</div>
                </div>
              </div>

              <div className="mt-4">
                <Select value={selectedTable?.tableName ?? ""} onValueChange={selectTable}>
                  <SelectTrigger className="h-11 border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)]">
                    <SelectValue placeholder="Select table" />
                  </SelectTrigger>
                  <SelectContent className="border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)]">
                    {tables.map((table) => (
                      <SelectItem key={table.tableName} value={table.tableName}>
                        {table.tableName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="smooth-chat-scroll mt-3 max-h-[calc(100vh-20rem)] space-y-1 overflow-y-auto pr-1">
                {tables.map((table, index) => {
                  const active = index === selectedIndex;
                  return (
                    <button
                      key={table.tableName}
                      type="button"
                      className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? "border-brand/45 bg-brand/10 text-[var(--home-text)]"
                          : "border-transparent text-[var(--home-muted)] hover:border-[var(--home-border)] hover:bg-[var(--home-soft)] hover:text-[var(--home-text)]"
                      }`}
                      onClick={() => selectTable(table.tableName)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Table2 className="h-4 w-4 shrink-0" />
                        <span className="truncate text-sm font-medium">{table.tableName}</span>
                      </span>
                      <span className="shrink-0 text-xs">{table.rowCount}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="min-w-0 rounded-2xl border border-[var(--home-border)] bg-[var(--home-panel)] p-4 shadow-2xl shadow-black/10 backdrop-blur">
              {selectedTable ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display text-xl font-semibold text-[var(--home-text)]">
                        {selectedTable.tableName}
                      </div>
                      <div className="mt-1 text-xs text-[var(--home-muted)]">
                        {selectedTable.rowCount} rows / {selectedTable.columns.length} headers
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-10 w-10 rounded-lg border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)] hover:bg-[var(--home-soft)]"
                        onClick={() => moveTable(-1)}
                        aria-label="Previous table"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-10 w-10 rounded-lg border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)] hover:bg-[var(--home-soft)]"
                        onClick={() => moveTable(1)}
                        aria-label="Next table"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="smooth-chat-scroll overflow-x-auto rounded-xl border border-[var(--home-border)] bg-[var(--home-panel-strong)]">
                    <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                      <thead className="bg-[var(--home-soft)] text-[var(--home-muted)]">
                        <tr>
                          {selectedTable.columns.map((column) => (
                            <th key={column.columnName} className="min-w-44 border-b border-[var(--home-border)] px-3 py-2 align-top">
                              <Input
                                value={headerEdits[selectedTable.tableName]?.[column.columnName] ?? column.displayName}
                                onChange={(event) => updateHeader(selectedTable.tableName, column.columnName, event.target.value)}
                                className="h-9 w-44 border-[var(--home-border)] bg-[var(--home-panel)] text-xs font-semibold text-[var(--home-text)]"
                                aria-label={`${selectedTable.tableName} ${column.columnName} header`}
                              />
                              <div className="mt-1 flex items-center gap-2 text-[10px] font-normal text-[var(--home-muted)]">
                                <span className="max-w-32 truncate">{column.columnName}</span>
                                <span>{column.type}</span>
                                {column.primaryKey ? <span>Key</span> : null}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTable.rows.length ? (
                          selectedTable.rows.map((row, rowIndex) => (
                            <tr key={`${selectedTable.tableName}-${rowIndex}`} className="border-b border-[var(--home-border)] last:border-b-0">
                              {selectedTable.columns.map((column) => (
                                <td key={column.columnName} className="max-w-64 truncate px-3 py-2.5 text-[var(--home-text)]">
                                  {cellText(row[column.columnName])}
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td className="px-4 py-10 text-center text-sm text-[var(--home-muted)]" colSpan={Math.max(1, selectedTable.columns.length)}>
                              No preview rows available.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[16rem] items-center justify-center rounded-xl border border-dashed border-[var(--home-border)] bg-[var(--home-soft)] text-sm text-[var(--home-muted)]">
                  No tables found.
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
