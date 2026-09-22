"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { API_ORIGIN, apiErrorMessage, getAccessToken } from "@/lib/faulttrace-api";
import type { ActiveEquipment, FaultReport } from "../../fault-report-types";

const fieldClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#07111c] px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 disabled:opacity-60";

export function FaultIntakeForm({
  workspaceId,
  initialEquipmentId,
}: {
  workspaceId: string;
  initialEquipmentId?: string;
}) {
  const [equipment, setEquipment] = useState<ActiveEquipment[]>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [faultCode, setFaultCode] = useState("");
  const [symptom, setSymptom] = useState("");
  const [plannedTask, setPlannedTask] = useState("");
  const [operatingContext, setOperatingContext] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdReport, setCreatedReport] = useState<FaultReport | null>(null);

  const loadEquipment = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_ORIGIN}/workspaces/${workspaceId}/equipment`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Active equipment could not be loaded."));
      }
      const records = (await response.json()) as ActiveEquipment[];
      setEquipment(records);
      if (initialEquipmentId && records.some((item) => item.id === initialEquipmentId)) {
        setEquipmentId(initialEquipmentId);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Active equipment could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [initialEquipmentId, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEquipment(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEquipment]);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || createdReport) return;
    setFormError(null);

    if (!equipmentId) {
      setFormError("Select active equipment for this fault report.");
      return;
    }
    if (!symptom.trim()) {
      setFormError("Describe the observed symptom or issue.");
      return;
    }

    setIsSaving(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_ORIGIN}/workspaces/${workspaceId}/fault-reports`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          equipment_id: equipmentId,
          fault_code: faultCode.trim() || null,
          symptom: symptom.trim(),
          planned_task: plannedTask.trim() || null,
          operating_context: operatingContext.trim() || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Fault report could not be saved."));
      }
      setCreatedReport((await response.json()) as FaultReport);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The fault-report service is unavailable.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p role="status" className="rounded-2xl border border-white/10 bg-[#101e2d] p-6 text-sm text-slate-400">Loading active equipment...</p>;
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-2xl border border-amber-300/25 bg-amber-300/5 p-6 text-sm text-amber-100">
        <p>{loadError}</p>
        <button type="button" onClick={() => void loadEquipment()} className="mt-4 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button>
      </div>
    );
  }

  if (equipment.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/15 bg-[#101e2d]/80 p-8 text-center">
        <h2 className="text-xl font-semibold text-white">No active equipment is available</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">Ask your maintenance lead to add or reactivate equipment before starting a fault report.</p>
        <Link href="/dashboard" className="mt-6 inline-flex rounded-xl border border-cyan-300/25 px-4 py-3 text-sm font-semibold text-cyan-100 hover:border-cyan-300/60">Return to dashboard</Link>
      </div>
    );
  }

  if (createdReport) {
    return (
      <div role="status" className="rounded-3xl border border-emerald-300/25 bg-emerald-300/5 p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Draft saved</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Complete the safety gate before work begins</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">The report is still Draft. Review and acknowledge every pre-task safety requirement to activate the case.</p>
        <Link href={`/dashboard/fault-reports/${createdReport.id}`} className="mt-6 inline-flex rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200">Continue to Safety Gate</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submitReport} noValidate aria-busy={isSaving} className="rounded-3xl border border-white/10 bg-[#101e2d]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.25)] sm:p-8">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm font-medium text-slate-300 md:col-span-2">
          Equipment <span className="text-cyan-300">*</span>
          <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} disabled={isSaving} className={fieldClass}>
            <option value="">Select active equipment</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>{item.name} ({item.asset_tag ?? "no asset ID"})</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-300">
          Fault code <span className="font-normal text-slate-500">(optional)</span>
          <input value={faultCode} onChange={(event) => setFaultCode(event.target.value)} disabled={isSaving} maxLength={120} className={fieldClass} placeholder="Example: F0001" />
        </label>
        <label className="block text-sm font-medium text-slate-300">
          Planned task <span className="font-normal text-slate-500">(optional)</span>
          <input value={plannedTask} onChange={(event) => setPlannedTask(event.target.value)} disabled={isSaving} maxLength={2000} className={fieldClass} placeholder="What work do you expect to perform?" />
        </label>
        <label className="block text-sm font-medium text-slate-300 md:col-span-2">
          Symptom or issue description <span className="text-cyan-300">*</span>
          <textarea value={symptom} onChange={(event) => setSymptom(event.target.value)} disabled={isSaving} maxLength={4000} className={`${fieldClass} min-h-32 resize-y`} placeholder="Describe what was observed, including alarms, behavior, or loss of function." />
        </label>
        <label className="block text-sm font-medium text-slate-300 md:col-span-2">
          Operating context or notes <span className="font-normal text-slate-500">(optional)</span>
          <textarea value={operatingContext} onChange={(event) => setOperatingContext(event.target.value)} disabled={isSaving} maxLength={4000} className={`${fieldClass} min-h-28 resize-y`} placeholder="Operating state, recent changes, environmental conditions, or other relevant context." />
        </label>
      </div>
      {formError && <p role="alert" className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">{formError}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
        <p className="max-w-xl text-xs leading-6 text-slate-500">Saving creates a Draft report. The case cannot become Active until every mandatory safety acknowledgement is completed.</p>
        <button type="submit" disabled={isSaving} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60">{isSaving ? "Saving draft..." : "Save and continue"}</button>
      </div>
    </form>
  );
}
