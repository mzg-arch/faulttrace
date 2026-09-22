"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_ORIGIN, apiErrorMessage, getAccessToken } from "@/lib/faulttrace-api";

type Equipment = {
  id: string;
  name: string;
  asset_tag: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  status: "active";
};

export function TechnicianEquipment({ workspaceId }: { workspaceId: string }) {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEquipment = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_ORIGIN}/workspaces/${workspaceId}/equipment`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Equipment could not be loaded."));
      }
      setEquipment((await response.json()) as Equipment[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Equipment could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEquipment(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEquipment]);

  const visibleEquipment = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return equipment;
    return equipment.filter((item) =>
      [item.name, item.asset_tag, item.manufacturer, item.model, item.location]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [equipment, query]);

  const selected = equipment.find((item) => item.id === selectedId) ?? null;

  return (
    <section className="my-10 rounded-3xl border border-cyan-300/15 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby="technician-equipment-title">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Workspace assets</p>
          <h2 id="technician-equipment-title" className="mt-2 text-2xl font-semibold text-white">Equipment</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Select active equipment from your workspace.</p>
        </div>
        <label className="block w-full text-sm text-slate-300 sm:max-w-sm">
          <span className="sr-only">Search equipment</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, asset ID, model, location..." className="w-full rounded-xl border border-white/15 bg-[#07111c] px-4 py-3 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300" />
        </label>
      </div>

      <div className="pt-7">
        {isLoading && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading active equipment...</p>}
        {loadError && (
          <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadEquipment()} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button>
          </div>
        )}
        {!isLoading && !loadError && equipment.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/15 p-7 text-center">
            <p className="font-medium text-slate-200">No active equipment is available.</p>
            <p className="mt-2 text-sm text-slate-500">Ask your maintenance lead to add or activate equipment.</p>
          </div>
        )}
        {!isLoading && !loadError && equipment.length > 0 && visibleEquipment.length === 0 && (
          <p className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">No equipment matches your search.</p>
        )}
        {!isLoading && !loadError && visibleEquipment.length > 0 && (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleEquipment.map((item) => {
              const isSelected = selectedId === item.id;
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => setSelectedId(item.id)} aria-pressed={isSelected} className={isSelected ? "h-full w-full rounded-2xl border border-cyan-300/60 bg-cyan-300/10 p-5 text-left shadow-[0_0_30px_rgba(103,232,249,0.08)]" : "h-full w-full rounded-2xl border border-white/10 bg-[#091522] p-5 text-left transition hover:border-cyan-300/30"}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-white">{item.name}</h3>
                      <span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200">active</span>
                    </div>
                    <p className="mt-3 font-mono text-xs text-cyan-200">{item.asset_tag ?? "Asset ID not assigned"}</p>
                    <p className="mt-4 text-sm text-slate-400">{[item.manufacturer, item.model].filter(Boolean).join(" · ") || "Manufacturer and model not provided"}</p>
                    <p className="mt-2 text-sm text-slate-500">{item.location ?? "Location not provided"}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#091522] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-slate-100">{selected ? selected.name : "Select equipment to start a fault report"}</p>
          <p className="mt-1 text-sm text-slate-500">Create a Draft intake, then complete the mandatory Safety Gate before work begins.</p>
        </div>
        {selected ? (
          <Link href={`/dashboard/fault-reports/new?equipment=${encodeURIComponent(selected.id)}`} className="shrink-0 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200">Start fault report</Link>
        ) : (
          <button type="button" disabled className="shrink-0 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#07111c] opacity-45">Start fault report</button>
        )}
      </div>
    </section>
  );
}
