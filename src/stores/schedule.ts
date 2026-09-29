import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { Conflict, ConflictType, DispositionMethod, DispositionRecord, Equipment, HistoryEntry, Location, OfflineDraft, Role, Scene, SceneStatus, Talent, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";

// Pinia 的 ref 是 Proxy，structuredClone 在部分浏览器/环境下会抛 DataCloneError；台账数据均为纯 JSON
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

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

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).scenes as Scene[] : clone(seedScenes);
  } catch {
    return clone(seedScenes);
  }
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).history as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function readVersions(): Version[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).versions as Version[] : [];
  } catch {
    return [];
  }
}

function readDispositions(): DispositionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).dispositions as DispositionRecord[] : [];
  } catch {
    return [];
  }
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

// 冲突指纹：场次排期要素决定冲突，要素一变旧处置即失效，旧豁免盖不到新通告
function fingerprintFor(type: ConflictType, a: Scene, b: Scene) {
  const scene = (s: Scene) => [s.code, s.day, s.start, s.end, s.locationId, [...s.talentIds].sort().join(","), [...s.equipmentIds].sort().join(",")].join("|");
  return `${type}:${[a.id, b.id].sort().join("=")}::${scene(a)}::${scene(b)}`;
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const dispositions = ref<DispositionRecord[]>(readDispositions());
  const role = ref<Role>("制片");
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

  const allConflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        const id = `${a.id}:${b.id}`;
        if (shared(a.talentIds, b.talentIds)) {
          const names = talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、");
          result.push({ id: `${id}:talent`, type: "演员档期", sceneIds: [a.id, b.id], message: `${names} 在两场戏中档期重叠`, severity: "高", fingerprint: fingerprintFor("演员档期", a, b) });
        }
        if (a.locationId === b.locationId) result.push({ id: `${id}:location`, type: "场地占用", sceneIds: [a.id, b.id], message: `${locationName(a.locationId)} 被同时占用`, severity: "高", fingerprint: fingerprintFor("场地占用", a, b) });
        if (shared(a.equipmentIds, b.equipmentIds)) {
          const names = equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、");
          result.push({ id: `${id}:equipment`, type: "器材借用", sceneIds: [a.id, b.id], message: `${names} 发生借用重叠`, severity: "中", fingerprint: fingerprintFor("器材借用", a, b) });
        }
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30) result.push({ id: `${id}:transfer`, type: "转场时间", sceneIds: [a.id, b.id], message: "两个场地之间转场时间不足30分钟", severity: "中", fingerprint: fingerprintFor("转场时间", a, b) });
      }
    }
    return result;
  });

  // 处置记录只有在指纹仍匹配当前冲突时才生效；通告变更后旧处置（含豁免）自动失效
  const activeFingerprints = computed(() => {
    const keys = new Set(allConflicts.value.map((item) => item.fingerprint));
    return new Set(dispositions.value.filter((item) => keys.has(item.fingerprint)).map((item) => item.fingerprint));
  });

  const conflicts = computed<Conflict[]>(() => allConflicts.value.filter((item) => !activeFingerprints.value.has(item.fingerprint)));

  function isRecordActive(record: DispositionRecord) {
    return allConflicts.value.some((item) => item.fingerprint === record.fingerprint);
  }

  function isRecordOverdue(record: DispositionRecord) {
    if (!isRecordActive(record)) return false;
    return dayjs(record.deadline).isBefore(dayjs(), "day");
  }

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenes: scenes.value, history: history.value, versions: versions.value, dispositions: dispositions.value }));
  }

  watch([scenes, history, versions, dispositions], persist, { deep: true });

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
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: clone(scenes.value), dispositions: clone(dispositions.value) });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = clone(version.scenes);
    // 场次与当时的处置记录一起回退；旧版本无台账字段时清空，宁见冲突也不让旧豁免盖到新通告
    dispositions.value = clone(version.dispositions ?? []);
    log("恢复版本", version.name);
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

  function registerDisposition(input: { conflictId: string; method: DispositionMethod; owner: string; deadline: string; note: string }) {
    const conflict = allConflicts.value.find((item) => item.id === input.conflictId);
    if (!conflict || role.value === "场记") return;
    // 同一冲突重复登记以最新处置为准，旧条目被替代（操作历史中仍可追溯）
    dispositions.value = dispositions.value.filter((item) => item.fingerprint !== conflict.fingerprint);
    const now = new Date().toISOString();
    dispositions.value.unshift({
      id: crypto.randomUUID(),
      conflictKey: conflict.id,
      fingerprint: conflict.fingerprint,
      type: conflict.type,
      severity: conflict.severity,
      sceneIds: [...conflict.sceneIds],
      message: conflict.message,
      method: input.method,
      owner: input.owner,
      deadline: input.deadline,
      note: input.note,
      handledAt: now,
      handler: role.value
    });
    log("登记冲突处置", `${conflict.type} · ${input.method} · 负责人 ${input.owner}`);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  return { scenes, sortedScenes, conflicts, dispositions, isRecordActive, isRecordOverdue, history, versions, role, online, draft, talents, locations, equipment, talentNames, equipmentNames, locationName, addScene, updateStatus, toggleLock, moveScene, snapshot, restore, saveDraft, loadDraft, syncDraft, registerDisposition, setOnline };
});
