import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { Conflict, ConflictResolution, Equipment, HistoryEntry, Location, OfflineDraft, ResolutionMethod, Role, Scene, SceneSnapshot, SceneStatus, Talent, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";

const talents: Talent[] = [
  { id: "t1", name: "林川", role: "男主" },
  { id: "t2", name: "周禾", role: "女主" },
  { id: "t3", name: "顾言", role: "配角" },
  { id: "t4", name: "孙宁", role: "群演领队" }
];

const locations: Location[] = [
  { id: "l1", name: "老码头" },
  { id: "l2", name: "玻璃厂房" },
  { id: "l3", name: "南站候车厅" }
];

const equipment: Equipment[] = [
  { id: "e1", name: "ARRI A机" },
  { id: "e2", name: "移动伸缩炮" },
  { id: "e3", name: "LED灯组" },
  { id: "e4", name: "跟拍车" }
];

const seedScenes: Scene[] = [
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1", "e3"], status: "已确认", locked: false },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false }
];

function readState() {
  try {
    return localStorage.getItem(STORAGE_KEY) ? JSON.parse(localStorage.getItem(STORAGE_KEY) as string) : {};
  } catch {
    return {};
  }
}

function readScenes(): Scene[] {
  const raw = readState();
  return raw.scenes ? raw.scenes as Scene[] : clone(seedScenes);
}

function readHistory(): HistoryEntry[] {
  return (readState().history ?? []) as HistoryEntry[];
}

function readVersions(): Version[] {
  const versions = (readState().versions ?? []) as Version[];
  // 兼容旧版本快照：旧快照没有处置记录，恢复时台账按空处理
  return versions.map((item) => ({ ...item, resolutions: item.resolutions ?? [] }));
}

function readResolutions(): ConflictResolution[] {
  return (readState().resolutions ?? []) as ConflictResolution[];
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

// 台账数据均为可 JSON 序列化结构（本就要写入 localStorage），用 JSON 深拷贝避免响应式代理带来的克隆差异
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// 场次排期指纹：参与冲突判定的要素一旦变化，旧处置即失效，不能盖到新通告上
function sceneFingerprint(scene: Scene) {
  return [
    scene.day,
    scene.start,
    scene.end,
    scene.locationId,
    [...scene.talentIds].sort().join(","),
    [...scene.equipmentIds].sort().join(",")
  ].join("|");
}

export interface ResolutionDraft {
  owner: string;
  deadline: string;
  note: string;
  method: ResolutionMethod;
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const resolutions = ref<ConflictResolution[]>(readResolutions());
  const role = ref<Role>("制片");
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

  function fingerprintOf(sceneIds: string[]): string {
    return sceneIds
      .map((id) => scenes.value.find((item) => item.id === id))
      .filter((item): item is Scene => Boolean(item))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(sceneFingerprint)
      .join("||");
  }

  function snapshotScenes(sceneIds: string[]): SceneSnapshot[] {
    return sceneIds.map((id) => {
      const scene = scenes.value.find((item) => item.id === id);
      return scene ? { sceneId: scene.id, code: scene.code, title: scene.title } : { sceneId: id, code: id, title: "场次已删除" };
    });
  }

  const conflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        const pairId = `${a.id}:${b.id}`;
        if (shared(a.talentIds, b.talentIds)) result.push({ id: `${pairId}:talent`, type: "演员档期", sceneIds: [a.id, b.id], message: `${talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、")} 在两场戏中档期重叠`, severity: "高" });
        if (a.locationId === b.locationId) result.push({ id: `${pairId}:location`, type: "场地占用", sceneIds: [a.id, b.id], message: `${locationName(a.locationId)} 被同时占用`, severity: "高" });
        if (shared(a.equipmentIds, b.equipmentIds)) result.push({ id: `${pairId}:equipment`, type: "器材借用", sceneIds: [a.id, b.id], message: `${equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、")} 发生借用重叠`, severity: "中" });
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30) result.push({ id: `${pairId}:transfer`, type: "转场时间", sceneIds: [a.id, b.id], message: "两个场地之间转场时间不足30分钟", severity: "中" });
      }
    }
    return result;
  });

  const activeResolutionMap = computed(() => {
    const map = new Map<string, ConflictResolution>();
    for (const item of resolutions.value) {
      if (item.fingerprint !== fingerprintOf(item.sceneIds)) continue;
      // resolutions 最新在前，同一冲突重复登记时以最新处置为准
      if (!map.has(item.conflictId)) map.set(item.conflictId, item);
    }
    return map;
  });

  // 待处理：当前仍存在且没有有效处置（含豁免）的冲突
  const pendingConflicts = computed(() => conflicts.value.filter((item) => !activeResolutionMap.value.has(item.id)));

  function resolutionState(item: ConflictResolution): "active" | "stale" | "missing" {
    const exists = item.sceneIds.every((id) => scenes.value.some((scene) => scene.id === id));
    if (!exists) return "missing";
    return item.fingerprint === fingerprintOf(item.sceneIds) ? "active" : "stale";
  }

  function isOverdue(item: ConflictResolution) {
    return resolutionState(item) === "active" && dayjs(item.deadline).endOf("day").isBefore(dayjs());
  }

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));
  const sortedResolutions = computed(() => [...resolutions.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenes: scenes.value, history: history.value, versions: versions.value, resolutions: resolutions.value }));
  }

  watch([scenes, history, versions, resolutions], persist, { deep: true });

  function addScene(input: Omit<Scene, "id" | "status" | "locked">) {
    scenes.value.push({ ...input, id: crypto.randomUUID(), status: "草稿", locked: false });
    log("新增场次", `${input.code} ${input.title}`);
  }

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
    scene.status = status;
    log("流转状态", `${scene.code} → ${status}`);
  }

  function toggleLock(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    scene.locked = !scene.locked;
    log(scene.locked ? "锁定场次" : "解锁场次", scene.code);
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.value.length) return;
    const [item] = scenes.value.splice(from, 1);
    scenes.value.splice(to, 0, item);
    log("调整顺序", `${item.code} 移至第 ${to + 1} 位`);
  }

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({
      id: crypto.randomUUID(),
      name,
      time: new Date().toISOString(),
      scenes: clone(scenes.value),
      resolutions: clone(resolutions.value)
    });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    // 场次与当时的处置记录一起回退；旧豁免只在旧排期上生效，盖不到新通告
    scenes.value = clone(version.scenes);
    resolutions.value = clone(version.resolutions ?? []);
    log("恢复版本", `${version.name}（含 ${resolutions.value.length} 条处置记录）`);
  }

  function saveDraft() {
    draft.value = { scenes: clone(scenes.value), savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    log("保存离线草稿", dayjs(draft.value.savedAt).format("MM-DD HH:mm"));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      draft.value = raw ? JSON.parse(raw) as OfflineDraft : null;
    } catch {
      draft.value = null;
    }
  }

  function syncDraft() {
    if (!draft.value) return;
    scenes.value = clone(draft.value.scenes);
    log("同步离线草稿", `同步 ${draft.value.scenes.length} 个场次`);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
  }

  // 冲突处置登记：记录负责人、复查期限、说明与处置方式，处置后进入已处理台账
  function registerResolution(conflict: Conflict, input: ResolutionDraft) {
    if (role.value === "场记") return;
    resolutions.value.unshift({
      id: crypto.randomUUID(),
      conflictId: conflict.id,
      type: conflict.type,
      severity: conflict.severity,
      message: conflict.message,
      sceneIds: [...conflict.sceneIds],
      sceneSnapshots: snapshotScenes(conflict.sceneIds),
      owner: input.owner.trim(),
      deadline: input.deadline,
      note: input.note.trim(),
      method: input.method,
      exempted: input.method === "负责人豁免",
      fingerprint: fingerprintOf(conflict.sceneIds),
      createdAt: new Date().toISOString(),
      createdBy: role.value
    });
    log("登记冲突处置", `${conflict.type}（${input.method}）负责人 ${input.owner.trim()}，复查期限 ${input.deadline}`);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  return {
    scenes, sortedScenes, conflicts, pendingConflicts, resolutions, sortedResolutions,
    history, versions, role, online, draft,
    talents, locations, equipment, talentNames, equipmentNames, locationName,
    resolutionState, isOverdue,
    addScene, updateStatus, toggleLock, moveScene, snapshot, restore,
    saveDraft, loadDraft, syncDraft, registerResolution, setOnline
  };
});
