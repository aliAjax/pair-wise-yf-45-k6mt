<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import dayjs from "dayjs";
import { useScheduleStore } from "../stores/schedule";
import type { Conflict, DispositionMethod } from "../types";

const store = useScheduleStore();
const readOnly = computed(() => store.role === "场记");

const dialogVisible = ref(false);
const current = ref<Conflict | null>(null);
const methods: DispositionMethod[] = ["豁免放行", "调整场次", "更换资源", "协调其他"];
const form = reactive({ method: "豁免放行" as DispositionMethod, owner: "", deadline: dayjs().add(1, "day").format("YYYY-MM-DD"), note: "" });
const errors = reactive({ owner: "", deadline: "", note: "" });

const records = computed(() => [...store.dispositions].sort((a, b) => b.handledAt.localeCompare(a.handledAt)));
const activeCount = computed(() => records.value.filter((item) => store.isRecordActive(item)).length);
const staleCount = computed(() => records.value.length - activeCount.value);

function sceneName(id: string) {
  const scene = store.scenes.find((item) => item.id === id);
  return scene ? `${scene.code} ${scene.title}` : "已删除场次";
}

function openDialog(item: Conflict) {
  current.value = item;
  Object.assign(form, { method: "豁免放行", owner: "", deadline: dayjs().add(1, "day").format("YYYY-MM-DD"), note: "" });
  errors.owner = "";
  errors.deadline = "";
  errors.note = "";
  dialogVisible.value = true;
}

function submit() {
  errors.owner = form.owner.trim() ? "" : "请填写负责人";
  errors.deadline = form.deadline ? "" : "请选择复查期限";
  errors.note = form.note.trim() ? "" : "请填写处置说明";
  if (errors.owner || errors.deadline || errors.note || !current.value) return;
  store.registerDisposition({ conflictId: current.value.id, method: form.method, owner: form.owner.trim(), deadline: form.deadline, note: form.note.trim() });
  dialogVisible.value = false;
}
</script>

<template>
  <section class="page">
    <div class="grid-2 conflict-grid">
      <section class="panel">
        <div class="panel-head">
          <div><h2>待处理冲突</h2><small class="muted">登记处置后自动进入台账，豁免放行不再计入待处理数量</small></div>
          <span class="status">{{ store.conflicts.length }} 项待处理</span>
        </div>
        <article v-for="item in store.conflicts" :key="item.id" class="conflict">
          <span class="seal">{{ item.severity }}</span>
          <div>
            <b>{{ item.type }}</b>
            <p>{{ item.message }}</p>
            <small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small>
          </div>
          <button class="primary" :disabled="readOnly" :title="readOnly ? '场记仅可查看，不能登记处置' : ''" @click="openDialog(item)">登记处置</button>
        </article>
        <el-empty v-if="!store.conflicts.length" description="当前没有未处理冲突" />
      </section>

      <section class="panel">
        <div class="panel-head">
          <div><h2>冲突处置台账</h2><small class="muted">生效 {{ activeCount }} 条 · 已失效 {{ staleCount }} 条 · 共 {{ records.length }} 条</small></div>
        </div>
        <el-empty v-if="!records.length" description="尚无处置记录" />
        <article v-for="item in records" :key="item.id" class="ledger-row">
          <div class="ledger-head">
            <span class="ledger-method" :class="item.method">{{ item.method }}</span>
            <b>{{ item.type }}</b>
            <span class="seal sm" :class="item.severity">{{ item.severity }}</span>
            <span class="ledger-tag" :class="store.isRecordActive(item) ? (store.isRecordOverdue(item) ? 'overdue' : 'active') : 'stale'">
              {{ store.isRecordActive(item) ? (store.isRecordOverdue(item) ? "已逾期" : "生效中") : "已失效" }}
            </span>
          </div>
          <p>{{ item.message }}</p>
          <small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small>
          <div class="ledger-meta">
            <span><b>负责人：</b>{{ item.owner }}</span>
            <span><b>复查期限：</b>{{ item.deadline }}</span>
            <span><b>登记人：</b>{{ item.handler }}</span>
            <span><b>处置时间：</b>{{ dayjs(item.handledAt).format("YYYY-MM-DD HH:mm") }}</span>
          </div>
          <div class="ledger-note"><b>说明：</b>{{ item.note }}</div>
          <div v-if="!store.isRecordActive(item)" class="ledger-hint">通告已变更，该处置不再覆盖当前冲突；如同类冲突仍在，请到待处理区重新登记。</div>
        </article>
      </section>
    </div>

    <el-dialog v-model="dialogVisible" title="登记冲突处置" width="460px">
      <form class="ledger-form" @submit.prevent="submit">
        <label class="field"><span>处置方式</span>
          <select v-model="form.method"><option v-for="item in methods" :key="item" :value="item">{{ item }}</option></select>
        </label>
        <label class="field"><span>负责人</span>
          <input v-model="form.owner" placeholder="谁在处理，如：演员统筹 周姐" /><small v-if="errors.owner" class="form-error">{{ errors.owner }}</small>
        </label>
        <label class="field"><span>复查期限</span>
          <input v-model="form.deadline" type="date" /><small v-if="errors.deadline" class="form-error">{{ errors.deadline }}</small>
        </label>
        <label class="field"><span>处置说明</span>
          <textarea v-model="form.note" rows="3" placeholder="为什么放行 / 如何解决，如：制片已确认拆分拍摄日"></textarea><small v-if="errors.note" class="form-error">{{ errors.note }}</small>
        </label>
        <div v-if="current" class="ledger-context">
          <small><b>{{ current.type }}</b>：{{ current.message }}</small>
        </div>
      </form>
      <template #footer>
        <button class="secondary" @click="dialogVisible = false">取消</button>
        <button class="primary" @click="submit">确认登记</button>
      </template>
    </el-dialog>
  </section>
</template>
