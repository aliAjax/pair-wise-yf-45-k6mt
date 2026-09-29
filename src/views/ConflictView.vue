<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import dayjs from "dayjs";
import { useScheduleStore } from "../stores/schedule";
import type { Conflict, ConflictResolution, ResolutionMethod } from "../types";

const store = useScheduleStore();

const methods: ResolutionMethod[] = ["调整时间", "更换演员", "更换场地", "协调器材", "负责人豁免"];
const readOnly = computed(() => store.role === "场记");

const dialogVisible = ref(false);
const current = ref<Conflict | null>(null);
const form = reactive({ owner: "", deadline: dayjs().add(1, "day").format("YYYY-MM-DD"), note: "", method: "调整时间" as ResolutionMethod });
const errors = reactive({ owner: "", note: "" });
const submitting = ref(false);

const activeCount = computed(() => store.sortedResolutions.filter((item) => store.resolutionState(item) === "active").length);
const staleCount = computed(() => store.sortedResolutions.length - activeCount.value);

function sceneName(id: string) {
  const scene = store.scenes.find((item) => item.id === id);
  return scene ? `${scene.code} ${scene.title}` : id;
}

function openDialog(item: Conflict) {
  if (readOnly.value) return;
  current.value = item;
  form.owner = store.role === "制片" ? "制片组" : "";
  form.deadline = dayjs().add(1, "day").format("YYYY-MM-DD");
  form.note = "";
  form.method = "调整时间";
  errors.owner = "";
  errors.note = "";
  dialogVisible.value = true;
}

function submit() {
  errors.owner = form.owner.trim() ? "" : "请填写负责人";
  errors.note = form.note.trim() ? "" : "请填写处置说明";
  if (!form.deadline) return;
  if (errors.owner || errors.note || !current.value) return;
  submitting.value = true;
  store.registerResolution(current.value, { owner: form.owner, deadline: form.deadline, note: form.note, method: form.method });
  dialogVisible.value = false;
  submitting.value = false;
  current.value = null;
}

function stateLabel(item: ConflictResolution) {
  const state = store.resolutionState(item);
  if (state === "stale") return { text: "已失效", cls: "stale", tip: "通告排期已变化，该处置不再适用，冲突重新进入待处理区" };
  if (state === "missing") return { text: "场次缺失", cls: "stale", tip: "关联场次已删除，处置记录仅作留档" };
  if (store.isOverdue(item)) return { text: "待复查", cls: "overdue", tip: "复查期限已到，请负责人跟进" };
  return { text: item.exempted ? "已豁免" : "已处置", cls: "active", tip: item.exempted ? "豁免有效，不计入待处理数量" : "处置有效，不计入待处理数量" };
}

function sceneSnapshotName(snapshot: { sceneId: string; code: string; title: string }) {
  return `${snapshot.code} ${snapshot.title}`;
}
</script>

<template>
  <section class="page">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>资源冲突中心</h2>
          <small class="muted">系统按日期和时间段检查演员、场地、器材与转场间隔；每条处置登记负责人、复查期限、说明与处置方式</small>
        </div>
        <div class="ledger-summary">
          <span class="status">{{ store.pendingConflicts.length }} 项待处理</span>
          <span class="status done">{{ activeCount }} 项已处理</span>
          <span v-if="staleCount" class="status stale-pill">{{ staleCount }} 项已失效</span>
        </div>
      </div>

      <h3 class="section-title">待处理冲突</h3>
      <article v-for="item in store.pendingConflicts" :key="item.id" class="conflict">
        <span class="seal">{{ item.severity }}</span>
        <div class="conflict-body">
          <b>{{ item.type }}</b>
          <p>{{ item.message }}</p>
          <small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small>
        </div>
        <button class="primary" :disabled="readOnly" @click="openDialog(item)">登记处置</button>
      </article>
      <el-empty v-if="!store.pendingConflicts.length" description="当前没有未处理冲突" />
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>冲突处置台账</h2>
          <small class="muted">处置完成后进入本区；豁免项不再计入待处理数量，记录永久可查。通告变化后旧处置自动失效，不会盖到新通告上</small>
        </div>
      </div>
      <el-empty v-if="!store.sortedResolutions.length" description="暂无处置记录" />
      <article v-for="item in store.sortedResolutions" :key="item.id" class="ledger" :class="store.resolutionState(item)">
        <div class="ledger-head">
          <span class="seal small">{{ item.severity }}</span>
          <b>{{ item.type }}</b>
          <span class="method-tag">{{ item.method }}</span>
          <span class="state-tag" :class="stateLabel(item).cls" :title="stateLabel(item).tip">{{ stateLabel(item).text }}</span>
          <small class="ledger-time">{{ dayjs(item.createdAt).format("YYYY-MM-DD HH:mm") }} · {{ item.createdBy }} 登记</small>
        </div>
        <p class="ledger-msg">{{ item.message }}</p>
        <div class="ledger-grid">
          <label><span>关联场次</span><b>{{ item.sceneSnapshots.map(sceneSnapshotName).join(" ↔ ") }}</b></label>
          <label><span>负责人</span><b>{{ item.owner }}</b></label>
          <label><span>复查期限</span><b :class="{ overdue: store.isOverdue(item) }">{{ item.deadline }}</b></label>
          <label class="wide"><span>处置说明</span><b>{{ item.note }}</b></label>
        </div>
        <small v-if="store.resolutionState(item) !== 'active'" class="ledger-warn">
          {{ store.resolutionState(item) === "missing" ? "关联场次已删除" : "通告排期已变化" }}，此记录仅作留档，不影响当前待处理数量
        </small>
      </article>
    </section>

    <el-dialog v-model="dialogVisible" title="登记冲突处置" width="520px" :close-on-click-modal="false">
      <form v-if="current" class="ledger-form" @submit.prevent="submit">
        <div class="ledger-target">
          <span class="seal small">{{ current.severity }}</span>
          <div><b>{{ current.type }}</b><p>{{ current.message }}</p><small>{{ current.sceneIds.map(sceneName).join(" ↔ ") }}</small></div>
        </div>
        <label class="field"><span>负责人 *</span>
          <input v-model="form.owner" list="owner-options" placeholder="谁在处理，如：周统筹" />
          <datalist id="owner-options">
            <option value="制片组" /><option value="导演组" /><option value="演员统筹" /><option value="场地协调" /><option value="器材组" />
          </datalist>
          <small class="error-text">{{ errors.owner }}</small>
        </label>
        <div class="form-row">
          <label class="field"><span>复查期限 *</span><input v-model="form.deadline" type="date" /></label>
          <label class="field"><span>处置方式 *</span>
            <select v-model="form.method">
              <option v-for="item in methods" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
        </div>
        <label class="field"><span>处置说明 *</span>
          <textarea v-model="form.note" rows="3" placeholder="为什么这样放行 / 如何整改，例如：A机调给B组，已确认09:00归还"></textarea>
          <small class="error-text">{{ errors.note }}</small>
        </label>
        <small class="muted">选择「负责人豁免」时，冲突将从待处理数量中移除，但本条记录保留在台账中可查。</small>
      </form>
      <template #footer>
        <button class="secondary" @click="dialogVisible = false">取消</button>
        <button class="primary" :disabled="submitting || readOnly" @click="submit">确认登记</button>
      </template>
    </el-dialog>
  </section>
</template>
