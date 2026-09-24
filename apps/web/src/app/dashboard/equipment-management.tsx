"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";

type EquipmentStatus = "active" | "archived";

type Equipment = {
  id: string;
  name: string;
  asset_tag: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  status: EquipmentStatus;
  created_at: string;
  updated_at: string;
};

type EquipmentForm = {
  name: string;
  asset_tag: string;
  manufacturer: string;
  model: string;
  location: string;
  status: EquipmentStatus;
};

const EMPTY_FORM: EquipmentForm = {
  name: "",
  asset_tag: "",
  manufacturer: "",
  model: "",
  location: "",
  status: "active",
};

const inputClass =
  "mt-2 w-full rounded-md border border-white/15 bg-[#0d0f10] px-3.5 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300 disabled:opacity-60";

function sortEquipment(records: Equipment[]) {
  return [...records].sort((left, right) =>
    left.name.localeCompare(right.name) || (left.asset_tag ?? "").localeCompare(right.asset_tag ?? ""),
  );
}

export function EquipmentManagement({ workspaceId }: { workspaceId: string }) {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      active: equipment.filter((item) => item.status === "active").length,
      archived: equipment.filter((item) => item.status === "archived").length,
    }),
    [equipment],
  );

  const loadEquipment = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/equipment`);
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Equipment could not be loaded."));
      }
      setEquipment(sortEquipment((await response.json()) as Equipment[]));
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

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  }

  function editEquipment(item: Equipment) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      asset_tag: item.asset_tag ?? "",
      manufacturer: item.manufacturer ?? "",
      model: item.model ?? "",
      location: item.location ?? "",
      status: item.status,
    });
    setFormError(null);
    setSuccess(null);
  }

  async function saveEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const payload = {
      name: form.name.trim().replace(/\s+/g, " "),
      asset_tag: form.asset_tag.trim().replace(/\s+/g, " "),
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      location: form.location.trim() || null,
      status: form.status,
    };
    setFormError(null);
    setSuccess(null);
    if (!payload.name) {
      setFormError("Enter an equipment name.");
      return;
    }
    if (!payload.asset_tag) {
      setFormError("Enter an asset ID or tag.");
      return;
    }

    setIsSaving(true);
    try {
      const endpoint = editingId
        ? `${API_ORIGIN}/workspaces/${workspaceId}/equipment/${editingId}`
        : `${API_ORIGIN}/workspaces/${workspaceId}/equipment`;
      const response = await authenticatedFetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setFormError(await apiErrorMessage(response, "Equipment could not be saved."));
        return;
      }

      const saved = (await response.json()) as Equipment;
      setEquipment((current) =>
        sortEquipment(editingId
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved]),
      );
      setSuccess(editingId ? "Equipment updated." : "Equipment added.");
      resetForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The equipment service is unavailable.");
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveEquipment(item: Equipment) {
    if (item.status === "archived" || archivingId) return;
    setArchivingId(item.id);
    setFormError(null);
    setSuccess(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/equipment/${item.id}/archive`,
        { method: "POST" },
      );
      if (!response.ok) {
        setFormError(await apiErrorMessage(response, "Equipment could not be archived."));
        return;
      }
      const archived = (await response.json()) as Equipment;
      setEquipment((current) =>
        sortEquipment(current.map((record) => (record.id === archived.id ? archived : record))),
      );
      if (editingId === item.id) resetForm();
      setSuccess(`${item.name} archived.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The equipment service is unavailable.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <section id="equipment" className="scroll-mt-6 rounded-lg border border-white/10 bg-[#151719] p-5 sm:p-6" aria-labelledby="equipment-management-title">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Admin controls</p>
          <h2 id="equipment-management-title" className="mt-2 text-xl font-semibold text-white">Equipment register</h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-zinc-400">
          Maintain the approved asset list for this workspace. Archived equipment remains available to administrators.
        </p>
      </div>

      <div className="grid gap-8 pt-7 xl:grid-cols-[1.25fr_0.75fr]">
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-white">Workspace equipment</h3>
            {!isLoading && !loadError && (
              <span className="text-xs text-zinc-500">{counts.active} active · {counts.archived} archived</span>
            )}
          </div>

          {isLoading && <p role="status" className="rounded-md border border-white/10 p-4 text-sm text-zinc-400">Loading equipment...</p>}
          {loadError && (
            <div role="alert" className="rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadEquipment()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Try again</button>
            </div>
          )}
          {!isLoading && !loadError && equipment.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/15 bg-[#111315]/60 p-7 text-center">
              <p className="font-medium text-zinc-200">No equipment has been added.</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Use the form to register the first approved asset.</p>
            </div>
          )}
          {!isLoading && !loadError && equipment.length > 0 && (
            <ul className="space-y-3">
              {equipment.map((item) => (
                <li key={item.id} className="rounded-lg border border-white/10 bg-[#111315] p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-white">{item.name}</h4>
                        <span className={item.status === "active" ? "rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200" : "rounded-full border border-zinc-400/20 bg-zinc-400/5 px-2.5 py-1 text-xs font-semibold text-zinc-400"}>
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-teal-200">{item.asset_tag ?? "Asset ID not assigned"}</p>
                      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                        <div><dt className="inline text-zinc-500">Manufacturer: </dt><dd className="inline text-zinc-300">{item.manufacturer ?? "—"}</dd></div>
                        <div><dt className="inline text-zinc-500">Model: </dt><dd className="inline text-zinc-300">{item.model ?? "—"}</dd></div>
                        <div className="sm:col-span-2"><dt className="inline text-zinc-500">Location: </dt><dd className="inline text-zinc-300">{item.location ?? "—"}</dd></div>
                      </dl>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => editEquipment(item)} disabled={isSaving || archivingId !== null} className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-teal-300/40 hover:text-teal-100 disabled:opacity-50">Edit</button>
                      {item.status === "active" && (
                        <button type="button" onClick={() => void archiveEquipment(item)} disabled={archivingId !== null || isSaving} className="rounded-md border border-amber-300/20 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300/50 disabled:opacity-50">
                          {archivingId === item.id ? "Archiving..." : "Archive"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={saveEquipment} noValidate aria-busy={isSaving} className="h-fit rounded-lg border border-white/10 bg-[#111315] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-white">{editingId ? "Edit equipment" : "Add equipment"}</h3>
            {editingId && <button type="button" onClick={resetForm} disabled={isSaving} className="text-xs font-semibold text-zinc-400 hover:text-white">Cancel</button>}
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm text-zinc-300">Equipment name<input className={inputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} disabled={isSaving} maxLength={120} /></label>
            <label className="block text-sm text-zinc-300">Asset ID / tag<input className={inputClass} value={form.asset_tag} onChange={(event) => setForm((current) => ({ ...current, asset_tag: event.target.value }))} disabled={isSaving} maxLength={80} autoCapitalize="characters" /></label>
            <label className="block text-sm text-zinc-300">Manufacturer<input className={inputClass} value={form.manufacturer} onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value }))} disabled={isSaving} maxLength={120} /></label>
            <label className="block text-sm text-zinc-300">Model<input className={inputClass} value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} disabled={isSaving} maxLength={120} /></label>
            <label className="block text-sm text-zinc-300">Location<input className={inputClass} value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} disabled={isSaving} maxLength={160} /></label>
            <label className="block text-sm text-zinc-300">Status<select className={inputClass} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as EquipmentStatus }))} disabled={isSaving}><option value="active">Active</option><option value="archived">Archived</option></select></label>
          </div>
          {formError && <p role="alert" className="mt-4 rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm text-red-100">{formError}</p>}
          {success && <p role="status" className="mt-4 rounded-md border border-emerald-300/25 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{success}</p>}
          <button type="submit" disabled={isSaving} className="mt-5 w-full rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] transition hover:bg-teal-200 disabled:cursor-wait disabled:opacity-60">
            {isSaving ? "Saving..." : editingId ? "Save changes" : "Add equipment"}
          </button>
        </form>
      </div>
    </section>
  );
}
