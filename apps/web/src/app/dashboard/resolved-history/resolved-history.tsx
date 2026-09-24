"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import { formatReportDate, type ResolvedReportSummary } from "../fault-report-types";

type EquipmentOption = {
  id: string;
  label: string;
};

export function ResolvedHistory({ workspaceId }: { workspaceId: string }) {
  const [reports, setReports] = useState<ResolvedReportSummary[]>([]);
  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentOption[]>([]);
  const [search, setSearch] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [hasFilters, setHasFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async (
    searchValue: string,
    equipmentValue: string,
    captureEquipment: boolean,
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const parameters = new URLSearchParams({ limit: "100" });
      const normalizedSearch = searchValue.trim();
      if (normalizedSearch) parameters.set("search", normalizedSearch);
      if (equipmentValue) parameters.set("equipment_id", equipmentValue);

      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/resolved-reports?${parameters.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Resolved history could not be loaded."));
      }

      const records = (await response.json()) as ResolvedReportSummary[];
      setReports(records);
      setHasFilters(Boolean(normalizedSearch || equipmentValue));
      if (captureEquipment) {
        const options = new Map<string, string>();
        records.forEach((report) => {
          options.set(
            report.equipment_id,
            `${report.equipment_name}${report.equipment_asset_tag ? ` (${report.equipment_asset_tag})` : ""}`,
          );
        });
        setEquipmentOptions(
          Array.from(options, ([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label)),
        );
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Resolved history could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory("", "", true), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  const resultLabel = useMemo(() => {
    if (isLoading) return "Loading resolved reports";
    if (reports.length === 1) return "1 resolved report";
    return `${reports.length} resolved reports`;
  }, [isLoading, reports.length]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadHistory(search, equipmentId, false);
  }

  function clearFilters() {
    setSearch("");
    setEquipmentId("");
    void loadHistory("", "", true);
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-[#101e2d]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.25)] sm:p-8">
      <form onSubmit={submitFilters} className="grid gap-4 border-b border-white/10 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.45fr)_auto]" aria-label="Filter resolved reports">
        <label className="text-sm font-medium text-slate-300">
          Search resolved cases
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={200}
            placeholder="Fault code, symptom, resolution, or work-log note"
            className="mt-2 w-full rounded-xl border border-white/15 bg-[#07111c] px-4 py-3 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300"
          />
        </label>
        <label className="text-sm font-medium text-slate-300">
          Equipment
          <select
            value={equipmentId}
            onChange={(event) => setEquipmentId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-white/15 bg-[#07111c] px-4 py-3 text-white outline-none focus:border-cyan-300"
          >
            <option value="">All equipment</option>
            {equipmentOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-3">
          <button type="submit" disabled={isLoading} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60">Search</button>
          {hasFilters && <button type="button" onClick={clearFilters} disabled={isLoading} className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-slate-200 hover:border-white/30 disabled:opacity-60">Clear</button>}
        </div>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-slate-400">{resultLabel}</p>
        <p className="text-xs text-slate-500">Newest resolutions first</p>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100">
          <p>{error}</p>
          <button type="button" onClick={() => void loadHistory(search, equipmentId, !search.trim() && !equipmentId)} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button>
        </div>
      )}
      {isLoading && <p className="mt-5 rounded-xl border border-white/10 p-5 text-sm text-slate-400">Loading workspace resolved history...</p>}
      {!isLoading && !error && reports.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-[#091522]/60 p-8 text-center">
          <h2 className="text-lg font-semibold text-white">{hasFilters ? "No resolved reports match these filters" : "No resolved reports yet"}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{hasFilters ? "Try a broader search or clear the equipment filter." : "Resolved technician reports will appear here as read-only case history."}</p>
        </div>
      )}
      {!isLoading && !error && reports.length > 0 && (
        <ul className="mt-5 grid gap-4 lg:grid-cols-2">
          {reports.map((report) => (
            <li key={report.id}>
              <Link href={`/dashboard/resolved-history/${report.id}`} className="group block h-full rounded-2xl border border-white/10 bg-[#091522] p-5 transition hover:border-cyan-300/35 hover:bg-[#0b1927]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">{report.equipment_asset_tag || "No asset ID"}</p>
                    <h2 className="mt-2 text-lg font-semibold text-white group-hover:text-cyan-100">{report.equipment_name}</h2>
                  </div>
                  <span className="rounded-full border border-violet-300/20 bg-violet-300/5 px-2.5 py-1 text-xs font-semibold text-violet-100">Resolved {formatReportDate(report.resolved_at)}</span>
                </div>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.12em] text-slate-600">Fault code</dt>
                    <dd className="mt-1 text-sm text-slate-200">{report.fault_code || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.12em] text-slate-600">Report owner</dt>
                    <dd className="mt-1 text-sm text-slate-200">{report.report_owner || "Technician"}</dd>
                  </div>
                </dl>
                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Symptom</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">{report.symptom}</p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Resolution summary</p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-300">{report.resolution_summary}</p>
                </div>
                <p className="mt-5 text-sm font-semibold text-cyan-200">Open complete read-only case</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-7 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-xs leading-6 text-amber-100/80">Historical outcomes are reference records. Review current approved procedures and evidence before acting; prior cases never override site safety, LOTO, authorization, or qualified technician judgment.</p>
    </section>
  );
}
