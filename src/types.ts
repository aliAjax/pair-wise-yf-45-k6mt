export type Role = "制片" | "导演" | "演员统筹" | "场记";
export type SceneStatus = "草稿" | "已确认" | "拍摄中" | "已完成";
export type ConflictType = "演员档期" | "场地占用" | "器材借用" | "转场时间";

export interface Talent {
  id: string;
  name: string;
  role: string;
}

export interface Location {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  name: string;
}

export interface Scene {
  id: string;
  code: string;
  title: string;
  day: string;
  start: string;
  end: string;
  talentIds: string[];
  locationId: string;
  equipmentIds: string[];
  status: SceneStatus;
  locked: boolean;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  sceneIds: string[];
  message: string;
  severity: "高" | "中";
}

export type ResolutionMethod = "调整时间" | "更换演员" | "更换场地" | "协调器材" | "负责人豁免";

export interface SceneSnapshot {
  sceneId: string;
  code: string;
  title: string;
}

export interface ConflictResolution {
  id: string;
  conflictId: string;
  type: ConflictType;
  severity: "高" | "中";
  message: string;
  sceneIds: string[];
  sceneSnapshots: SceneSnapshot[];
  owner: string;
  deadline: string;
  note: string;
  method: ResolutionMethod;
  exempted: boolean;
  fingerprint: string;
  createdAt: string;
  createdBy: Role;
}

export interface HistoryEntry {
  id: string;
  action: string;
  detail: string;
  time: string;
}

export interface Version {
  id: string;
  name: string;
  time: string;
  scenes: Scene[];
  resolutions: ConflictResolution[];
}

export interface OfflineDraft {
  scenes: Scene[];
  savedAt: string;
}
