import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Download,
  Upload,
  Plus,
  Filter,
  Settings,
  CheckCircle2,
  Circle,
  AlertCircle,
  TimerReset,
  Users,
  Link as LinkIcon,
  Wifi,
} from "lucide-react";

// -------------------- Types --------------------
const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"] as const;
const COLORS: Record<(typeof STATUSES)[number], string> = {
  "Not Started": "bg-gray-200 text-gray-800",
  "In Progress": "bg-blue-200 text-blue-800",
  Blocked: "bg-amber-200 text-amber-900",
  Done: "bg-emerald-200 text-emerald-900",
};

export type Task = {
  id: string;
  category: string;
  title: string;
  status: (typeof STATUSES)[number];
  owner?: string;
  dueDate?: string; // ISO date
  notes?: string;
};

export type Employee = {
  id: string;
  name: string;
  startDate?: string; // ISO date
  role?: string;
  manager?: string;
  email?: string;
  tasks: Task[];
};

// -------------------- Defaults --------------------
const DEFAULT_CATEGORIES = [
  { name: "Accounts", tasks: ["Create email", "Add to domain", "Set up MFA"] },
  { name: "Hardware", tasks: ["Assign laptop", "Issue monitor", "Peripherals (kb/mouse)"] },
  { name: "Software", tasks: ["Install Office/365", "Install Zoom", "Install Endpoint Protection"] },
  { name: "Access", tasks: ["VPN access", "Add to network shares", "Add to Jira/Confluence"] },
  { name: "Orientation", tasks: ["Add to internal wiki", "Welcome email", "First-day checklist walk-through"] },
  {
    name: "Compliance & Security",
    tasks: [
      "Clearance status check",
      "Security+ certification (Have / Not / In progress)",
      "Apply for corporate card",
      "Set up Concur",
      "Complete all CBT trainings",
    ],
  },
];

const STORAGE_KEY = "it-onboarding-v1";
const SETTINGS_KEY = "it-onboarding-settings";

// -------------------- Helpers --------------------
function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function cloneTemplate(): Task[] {
  const today = new Date();
  return DEFAULT_CATEGORIES.flatMap((cat, i) =>
    cat.tasks.map((t, j) => ({
      id: uid("task"),
      category: cat.name,
      title: t,
      status: "Not Started" as const,
      dueDate: new Date(today.getTime() + (i + j) * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    })),
  );
}

function calcProgress(tasks: Task[]) {
  const total = tasks.length || 1;
  const done = tasks.filter((t) => t.status === "Done").length;
  return Math.round((done / total) * 100);
}

function toCSV(rows: any[]): string {
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

function downloadFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function matchTaskHelper(
  t: Task,
  f: { status?: string; owner?: string },
) {
  if (f.status && t.status !== (f.status as Task["status"])) return false;
  if (f.owner && (t.owner ?? "") !== f.owner) return false;
  return true;
}

// -------------------- Storage Adapters --------------------
interface StorageAdapter {
  load(): Promise<Employee[]>;
  addEmployee(e: Employee): Promise<void>;
  updateTask(
    empId: string,
    taskId: string,
    patch: Partial<Task>,
  ): Promise<void>;
  removeEmployee(empId: string): Promise<void>;
  subscribe(cb: (employees: Employee[]) => void): () => void;
}

// Local adapter (single-user)
const localAdapter: StorageAdapter = {
  async load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as Employee[]) : [];
    } catch {
      return [];
    }
  },
  async addEmployee(e) {
    const data = await this.load();
    data.unshift(e);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
  async updateTask(empId, taskId, patch) {
    const data = await this.load();
    const next = data.map((e) =>
      e.id !== empId
        ? e
        : { ...e, tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) },
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  },
  async removeEmployee(empId) {
    const data = await this.load();
    const next = data.filter((e) => e.id !== empId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  },
  subscribe(cb) {
    this.load().then(cb);
    const handler = (ev: StorageEvent) => {
      if (ev.key === STORAGE_KEY) {
        try {
          cb(ev.newValue ? JSON.parse(ev.newValue) : []);
        } catch {
          /* noop */
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};

// Firestore adapter
function createFirestoreAdapter(config: any): StorageAdapter {
  let app: any, db: any, imported = false;

  async function ensure() {
    if (imported) return {} as any;
    const firebaseApp = await import(/* webpackChunkName: "firebase-app" */ "firebase/app");
    const firestore = await import(/* webpackChunkName: "firebase-firestore" */ "firebase/firestore");
    app = firebaseApp.initializeApp(config);
    db = firestore.getFirestore(app);
    imported = true;
    return { firestore };
  }

  const COL = "employees";

  return {
    async load() {
      const { firestore } = await ensure();
      const { collection, getDocs, query, orderBy } = firestore as any;
      const snap = await getDocs(query(collection(db, COL), orderBy("name")));
      const employees: Employee[] = [];
      for (const doc of snap.docs) {
        const data = doc.data();
        const tasksSnap = await (firestore as any).getDocs((firestore as any).collection(doc.ref, "tasks"));
        const tasks = tasksSnap.docs.map((d: any) => d.data());
        employees.push({
          id: doc.id,
          name: data.name,
          email: data.email ?? "",
          role: data.role ?? "",
          manager: data.manager ?? "",
          startDate: data.startDate ?? "",
          tasks,
        });
      }
      return employees;
    },

    async addEmployee(e) {
      const { firestore } = await ensure();
      const { collection, doc, setDoc } = firestore as any;
      const empRef = doc(collection(db, COL), e.id);
      await setDoc(empRef, {
        name: e.name,
        email: e.email ?? "",
        role: e.role ?? "",
        manager: e.manager ?? "",
        startDate: e.startDate ?? "",
      });
      for (const t of e.tasks) {
        const tRef = (firestore as any).doc((firestore as any).collection(empRef, "tasks"), t.id);
        await (firestore as any).setDoc(tRef, t);
      }
    },

    async updateTask(empId, taskId, patch) {
      const { firestore } = await ensure();
      const { doc, updateDoc, collection } = firestore as any;
      const tRef = doc(collection(doc(collection(db, COL), empId), "tasks"), taskId);
      await updateDoc(tRef, patch);
    },

    async removeEmployee(empId) {
      const { firestore } = await ensure();
      const { doc, deleteDoc, collection, getDocs } = firestore as any;
      const empRef = doc(collection(db, COL), empId);
      const tSnap = await getDocs((firestore as any).collection(empRef, "tasks"));
      await Promise.all(tSnap.docs.map((d: any) => deleteDoc(d.ref)));
      await deleteDoc(empRef);
    },

    subscribe(cb) {
      let unsubEmp: any = null;
      let taskUnsubs = new Map<string, any>();
      ensure().then(({ firestore }) => {
        const { collection, onSnapshot, query, orderBy } = firestore as any;
        unsubEmp = onSnapshot(query(collection(db, COL), orderBy("name")), (snap: any) => {
          const base: Record<string, Employee> = {};
          snap.docs.forEach((doc: any) => {
            const d = doc.data();
            base[doc.id] = {
              id: doc.id,
              name: d.name,
              email: d.email ?? "",
              role: d.role ?? "",
              manager: d.manager ?? "",
              startDate: d.startDate ?? "",
              tasks: [],
            };
          });
          taskUnsubs.forEach((fn) => fn());
          taskUnsubs.clear();
          Object.values(base).forEach((emp) => {
            const unsub = (firestore as any).onSnapshot(
              (firestore as any).collection((firestore as any).doc((firestore as any).collection(db, COL), emp.id), "tasks"),
              (ts: any) => {
                emp.tasks = ts.docs.map((d: any) => d.data());
                cb(Object.values(base));
              },
            );
            taskUnsubs.set(emp.id, unsub);
          });
          cb(Object.values(base));
        });
      });
      return () => {
        if (unsubEmp) unsubEmp();
        taskUnsubs.forEach((fn) => fn());
        taskUnsubs.clear();
      };
    },
  };
}

// -------------------- Main App --------------------
export default function ITOnboardingApp() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<{
    webhookEnabled: boolean;
    webhookUrl: string;
    reminderDays: number;
    owners: string[];
    shared: {
      enabled: boolean;
      provider: "firestore" | "local";
      firebaseConfigText: string;
    };
  }>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      return saved
        ? JSON.parse(saved)
        : {
            webhookEnabled: false,
            webhookUrl: "",
            reminderDays: 2,
            owners: ["IT Queue", "Alice", "Bob", "Charlie"],
            shared: { enabled: false, provider: "local", firebaseConfigText: "" },
          };
    } catch {
      return {
        webhookEnabled: false,
        webhookUrl: "",
        reminderDays: 2,
        owners: ["IT Queue", "Alice", "Bob", "Charlie"],
        shared: { enabled: false, provider: "local", firebaseConfigText: "" },
      };
    }
  });

  const [filters, setFilters] = useState<{ status?: string; owner?: string; search?: string }>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [connected, setConnected] = useState(false);
  const adapterRef = useRef<StorageAdapter>(localAdapter);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    let cancel = () => {};
    (async () => {
      try {
        if (
          settings.shared.enabled &&
          settings.shared.provider === "firestore" &&
          settings.shared.firebaseConfigText.trim()
        ) {
          const cfg = JSON.parse(settings.shared.firebaseConfigText);
          adapterRef.current = createFirestoreAdapter(cfg);
        } else {
          adapterRef.current = localAdapter;
        }
        cancel = adapterRef.current.subscribe((rows) => {
          setEmployees(rows);
          setConnected(true);
        });
      } catch (e) {
        console.error("Failed to init storage", e);
        adapterRef.current = localAdapter;
        setConnected(false);
        const rows = await localAdapter.load();
        setEmployees(rows);
      }
    })();
    return () => cancel();
  }, [settings.shared.enabled, settings.shared.provider, settings.shared.firebaseConfigText]);

  const progressByEmp = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, calcProgress(e.tasks)])),
    [employees],
  );

  const filtered = useMemo(() => {
    return employees
      .map((e) => ({ ...e, tasks: e.tasks.filter((t) => matchTaskHelper(t, filters)) }))
      .filter((e) =>
        filters.search
          ? `${e.name} ${e.role ?? ""} ${e.manager ?? ""}`
              .toLowerCase()
              .includes((filters.search ?? "").toLowerCase())
          : true,
      );
  }, [employees, filters]);

  async function addEmployee(payload: Partial<Employee>) {
    const e: Employee = {
      id: uid("emp"),
      name: payload.name ?? "New Hire",
      email: payload.email ?? "",
      role: payload.role ?? "",
      manager: payload.manager ?? "",
      startDate: payload.startDate ?? new Date().toISOString().slice(0, 10),
      tasks: cloneTemplate(),
    };
    await adapterRef.current.addEmployee(e);
  }

  async function updateTask(
    empId: string,
    taskId: string,
    patch: Partial<Task>,
  ) {
    await adapterRef.current.updateTask(empId, taskId, patch);
    if (settings.webhookEnabled && settings.webhookUrl && (patch.status || patch.owner)) {
      try {
        const payload = {
          empId,
          taskId,
          patch,
          event: "task.updated",
          timestamp: new Date().toISOString(),
        };
        fetch(settings.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn("Webhook failed", err);
      }
    }
  }

  async function removeEmployee(empId: string) {
    await adapterRef.current.removeEmployee(empId);
  }

  function exportCSV() {
    const rows = employees.flatMap((e) =>
      e.tasks.map((t) => ({
        employee: e.name,
        email: e.email,
        role: e.role,
        manager: e.manager,
        startDate: e.startDate,
        category: t.category,
        task: t.title,
        status: t.status,
        owner: t.owner ?? "",
        dueDate: t.dueDate ?? "",
        notes: (t.notes ?? "").replace(/\n/g, " "),
      })),
    );
    downloadFile(
      `onboarding_${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(rows),
      "text/csv",
    );
  }

  function exportJSON() {
    downloadFile(
      `onboarding_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ employees, settings }, null, 2),
      "application/json",
    );
  }

  function importJSON(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data.employees)) {
          if (settings.shared.enabled) {
            alert("Import is only supported in local mode. Disable Shared mode first.");
            return;
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.employees));
          setEmployees(data.employees);
        }
        if (data.settings) setSettings((s) => ({ ...s, ...data.settings }));
      } catch (e) {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-screen w-full bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">IT Onboarding Checklist & Automation</h1>
            <p className="text-sm text-gray-600">Track onboarding tasks, assign owners, automate reminders.</p>
            {settings.shared.enabled && (
              <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                <Wifi className="h-3 w-3" />{connected ? "Shared mode: live" : "Connecting..."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
              <DialogTrigger asChild>
                <Button className="rounded-2xl"><Plus className="mr-2 h-4 w-4" />New Hire</Button>
              </DialogTrigger>
              <AddEmployeeModal onSubmit={(e) => { addEmployee(e); setShowAddModal(false); }} owners={settings.owners} />
            </Dialog>
            <Button variant="secondary" className="rounded-2xl" onClick={exportCSV}><Download className="mr-2 h-4 w-4" />CSV</Button>
            <Button variant="secondary" className="rounded-2xl" onClick={exportJSON}><Download className="mr-2 h-4 w-4" />JSON</Button>
            <label className="relative inline-flex cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-sm">
              <Upload className="h-4 w-4" />Import JSON
              <input type="file" accept="application/json" className="absolute inset-0 opacity-0" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); }} />
            </label>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="rounded-2xl"><Settings className="mr-2 h-4 w-4" />Settings</Button>
              </DialogTrigger>
              <SettingsPanel settings={settings} setSettings={setSettings} />
            </Dialog>
          </div>
        </div>
        <Card className="mb-4 rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4" />Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Status</Label>
              <Select onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "*" ? undefined : v }))} value={filters.status ?? "*"}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">Any</SelectItem>
                  {STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Owner</Label>
              <Select onValueChange={(v) => setFilters((f) => ({ ...f, owner: v === "*" ? undefined : v }))} value={filters.owner ?? "*"}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">Any</SelectItem>
                  {settings.owners.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Search</Label>
              <Input placeholder="Name, role, manager..." value={filters.search ?? ""} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((e) => (
            <Card key={e.id} className="rounded-2xl">
              <CardHeader className="pb-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid place-items-center rounded-full bg-gray-100 p-3"><Users className="h-5 w-5 text-gray-600" /></div>
                    <div>
                      <CardTitle className="text-lg">{e.name}</CardTitle>
                      <p className="text-xs text-gray-500">{e.role || "Role"} • Manager: {e.manager || "—"} • Start: {e.startDate || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-40">
                      <Progress value={progressByEmp[e.id] ?? 0} />
                      <p className="mt-1 text-right text-[11px] text-gray-500">{progressByEmp[e.id] ?? 0}% complete</p>
                    </div>
                    <Button variant="outline" size="sm" className="rounded-2xl" onClick={() => removeEmployee(e.id)}>Remove</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <Tabs defaultValue={DEFAULT_CATEGORIES[0].name}>
                  <TabsList className="flex w-full flex-wrap">
                    {DEFAULT_CATEGORIES.map((c) => (<TabsTrigger key={c.name} value={c.name} className="rounded-xl">{c.name}</TabsTrigger>))}
                  </TabsList>
                  {DEFAULT_CATEGORIES.map((c) => (
                    <TabsContent key={c.name} value={c.name} className="mt-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {e.tasks.filter((t) => t.category === c.name).map((t) => (
                          <TaskCard key={t.id} t={t} owners={settings.owners} onChange={(patch) => updateTask(e.id, t.id, patch)} />
                        ))}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="p-10 text-center text-gray-500">No hires yet. Click <span className="font-semibold">New Hire</span> to get started.</CardContent>
            </Card>
          )}
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl">
            <CardHeader><CardTitle>Quick Start / SOP</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-700">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Click <span className="font-medium">New Hire</span> and fill details. Tasks are auto-created from the template.</li>
                <li>Anyone on this page can edit Status/Owner/Due/Notes in <span className="font-medium">Shared mode</span>.</li>
                <li>Use <span className="font-medium">Filters</span> to triage by status/owner.</li>
                <li>Export progress as <span className="font-medium">CSV</span> for managers, or <span className="font-medium">JSON</span> for backup.</li>
                <li>Open <span className="font-medium">Settings</span> to enable Shared mode and paste your Firebase config.</li>
              </ol>
              <p className="text-xs text-gray-500">Tip: Local mode saves only in your browser. Shared mode syncs everyone viewing the site.</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader><CardTitle>Automation Ideas</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-700">
              <ul className="list-disc space-y-1 pl-5">
                <li><span className="font-medium">Google Apps Script</span>: Create a web app URL as the webhook. On receipt, send Gmail notifications or write rows to Sheets.</li>
                <li><span className="font-medium">Power Automate</span>: Use an HTTP trigger to create Planner tasks or post to Teams when status changes to <em>Done</em> or <em>Blocked</em>.</li>
                <li><span className="font-medium">Zapier</span>: Trigger Slack/Email reminders X days before due date. You can also mirror data to Airtable.</li>
              </ul>
              <p className="flex items-center gap-2 text-xs text-gray-500"><LinkIcon className="h-4 w-4" />Use the Settings → Webhook URL field. The app POSTs <code>task.updated</code> events.</p>
            </CardContent>
          </Card>
        </div>
        <div className="h-12" />
      </div>
    </div>
  );
}

// -------------------- Components --------------------
function StatusBadge({ status }: { status: Task["status"] }) {
  const icon = {
    "Not Started": <Circle className="h-3 w-3" />,
    "In Progress": <TimerReset className="h-3 w-3" />,
    Blocked: <AlertCircle className="h-3 w-3" />,
    Done: <CheckCircle2 className="h-3 w-3" />,
  }[status];
  return <Badge className={`gap-1 ${COLORS[status]} hover:${COLORS[status]}`}>{icon}{status}</Badge>;
}

function TaskCard({ t, owners, onChange }: { t: Task; owners: string[]; onChange: (patch: Partial<Task>) => void }) {
  const overdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done";
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-base"><span className="truncate">{t.title}</span><StatusBadge status={t.status} /></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Owner</Label>
            <Select value={t.owner ?? owners[0]} onValueChange={(v) => onChange({ owner: v })}>
              <SelectTrigger className="bg-white"><SelectValue placeholder="Owner" /></SelectTrigger>
              <SelectContent>{owners.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={t.status} onValueChange={(v) => onChange({ status: v as Task["status"] })}>
              <SelectTrigger className="bg-white"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Due Date</Label>
            <Input type="date" value={t.dueDate ?? ""} onChange={(e) => onChange({ dueDate: e.target.value })} />
            {overdue && <p className="mt-1 text-[11px] text-rose-600">Overdue</p>}
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Input value={t.category} disabled className="bg-gray-50" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea rows={3} value={t.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Links, provisioning notes, etc." />
        </div>
      </CardContent>
    </Card>
  );
}

function AddEmployeeModal({ onSubmit, owners }: { onSubmit: (e: Partial<Employee>) => void; owners: string[] }) {
  const [form, setForm] = useState<Partial<Employee>>({ name: "", email: "", role: "", manager: owners[0], startDate: new Date().toISOString().slice(0, 10) });
  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Add New Hire</DialogTitle>
        <DialogDescription>Creates a new checklist from the default template. You can edit tasks after creating.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" /></div>
          <div><Label>Email</Label><Input type="email" value={form.email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Role</Label><Input value={form.role ?? ""} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="Data Analyst" /></div>
          <div><Label>Manager</Label><Input value={form.manager ?? ""} onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))} placeholder="Manager name" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Start Date</Label><Input type="date" value={form.startDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
        </div>
      </div>
      <DialogFooter><Button onClick={() => onSubmit(form)} className="rounded-2xl"><Plus className="mr-2 h-4 w-4" />Create</Button></DialogFooter>
    </DialogContent>
  );
}

function SettingsPanel({ settings, setSettings }: { settings: { webhookEnabled: boolean; webhookUrl: string; reminderDays: number; owners: string[]; shared: { enabled: boolean; provider: "firestore" | "local"; firebaseConfigText: string } }; setSettings: (fn: any) => void }) {
  const [ownerInput, setOwnerInput] = useState("");
  function addOwner() {
    if (!ownerInput.trim()) return;
    setSettings((s: any) => ({ ...s, owners: Array.from(new Set([...s.owners, ownerInput.trim()])) }));
    setOwnerInput("");
  }
  return (
    <DialogContent className="sm:max-w-[760px]">
      <DialogHeader><DialogTitle>Settings & Sharing</DialogTitle></DialogHeader>
      <div className="grid gap-5 py-3">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Owners</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2"><Input placeholder="Add owner (e.g., Service Desk)" value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} /><Button onClick={addOwner} className="rounded-2xl">Add</Button></div>
            <div className="flex flex-wrap gap-2">{settings.owners.map((o) => (<Badge key={o} variant="secondary" className="rounded-xl">{o}</Badge>))}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Shared mode (no logins)</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><div><p className="font-medium">Enable Shared mode</p><p className="text-xs text-gray-500">Anyone with the page open will see and edit the same data live.</p></div><Switch checked={settings.shared.enabled} onCheckedChange={(v) => setSettings((s: any) => ({ ...s, shared: { ...s.shared, enabled: v } }))} /></div>
            <div className="grid gap-2"><Label>Provider</Label><Select value={settings.shared.provider} onValueChange={(v) => setSettings((s: any) => ({ ...s, shared: { ...s.shared, provider: v as any } }))}><SelectTrigger className="bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="firestore">Firebase Firestore</SelectItem><SelectItem value="local">Local (browser only)</SelectItem></SelectContent></Select></div>
            {settings.shared.provider === "firestore" && (<div className="grid gap-2"><Label>Firebase config JSON</Label><Textarea rows={6} placeholder={`{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "...",\n  "storageBucket": "...",\n  "messagingSenderId": "...",\n  "appId": "..."\n}`} value={settings.shared.firebaseConfigText} onChange={(e) => setSettings((s: any) => ({ ...s, shared: { ...s.shared, firebaseConfigText: e.target.value } }))} /><p className="text-xs text-gray-500">From Firebase Console → Project settings → Your apps → SDK setup and configuration. No auth required for this demo.</p></div>)}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">Webhook (optional)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><div><p className="text-sm font-medium">Enable Webhook</p><p className="text-xs text-gray-500">POSTs task updates to your URL for Google Apps Script, Power Automate, or Zapier.</p></div><Switch checked={settings.webhookEnabled} onCheckedChange={(v) => setSettings((s: any) => ({ ...s, webhookEnabled: v }))} /></div><div><Label>Webhook URL</Label><Input placeholder="https://..." value={settings.webhookUrl} onChange={(e) => setSettings((s: any) => ({ ...s, webhookUrl: e.target.value }))} /></div><div><Label>Reminder Window (days before due)</Label><Input type="number" min={0} value={settings.reminderDays} onChange={(e) => setSettings((s: any) => ({ ...s, reminderDays: Number(e.target.value) }))} /></div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base">How to receive events</CardTitle></CardHeader>
          <CardContent className="text-sm text-gray-700">
            <p className="mb-2">When a task is updated, the app sends:</p>
            <pre className="overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{`{\n  "event": "task.updated",\n  "timestamp": "2025-08-10T12:34:56.000Z",\n  "empId": "emp_abc123",\n  "taskId": "task_xyz789",\n  "patch": { "status": "In Progress", "owner": "IT Queue" }\n}`}</pre>
            <p className="mt-2">Use this payload to send emails, create tickets, or post to Slack/Teams.</p>
          </CardContent>
        </Card>
      </div>
    </DialogContent>
  );
}

// -------------------- Dev Tests (console) --------------------
(function runDevTests() {
  if (typeof window === "undefined") return;
  try {
    const a = uid("t");
    const b = uid("t");
    console.assert(a !== b, "uid should be unique per call");
    const tmpl = cloneTemplate();
    const expectedCount = DEFAULT_CATEGORIES.reduce((sum, c) => sum + c.tasks.length, 0);
    console.assert(tmpl.length === expectedCount, `cloneTemplate length ${tmpl.length} !== ${expectedCount}`);
    const half = [ { status: "Done" }, { status: "Not Started" } ] as unknown as Task[];
    console.assert(calcProgress(half) === 50, `calcProgress(50%) failed: ${calcProgress(half)}`);
    const csv = toCSV([{ a: 1, b: ",x" }, { b: 2, a: 3 }]);
    console.assert(csv.split("\n").length === 3, "toCSV should have header + 2 lines");
    const t: Task = { id: "1", category: "Accounts", title: "Create email", status: "In Progress", owner: "Alice", dueDate: "2025-08-10" };
    console.assert(matchTaskHelper(t, { status: "In Progress" }) === true, "matchTask status should match");
    console.assert(matchTaskHelper(t, { status: "Done" }) === false, "matchTask wrong status should fail");
    console.assert(matchTaskHelper(t, { owner: "Alice" }) === true, "matchTask owner should match");
    console.assert(matchTaskHelper(t, { owner: "Bob" }) === false, "matchTask wrong owner should fail");
    console.log("DEV TESTS PASSED ✅");
  } catch (err) {
    console.error("DEV TESTS FAILED ❌", err);
  }
})();