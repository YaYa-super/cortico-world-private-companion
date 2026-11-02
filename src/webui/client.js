/**
 * 记忆面板（浏览器侧）：只读概览/检索/合并列表，唯一写操作是撤销合并。
 * 不 import 框架运行时，只用 ctx.ui 与 ctx.invoke；服务端方法见 world.ts 的 invokeMemoryPanel。
 */
const ZH = {
  title: '记忆',
  desc: '只读查看这套记忆：概览、检索、合并摘要。导入审核仍走 CLI，这里不批准导入。',
  overview: '概览',
  overviewDesc: '当前库里有什么，最近一次巩固/合并/反思是什么时候。',
  records: '记录',
  events: '原始事件',
  kinds: '类型分布',
  scopes: '域分布',
  archived: '已归档',
  merged: '合并摘要',
  musing: '胡思乱想',
  rules: '规则',
  people: '人物卡',
  threads: '未完成的话头',
  quarantine: '隔离区待审',
  lastConsolidate: '上次巩固',
  lastMerge: '上次合并',
  lastReflect: '上次周反思',
  surfaced: '最近提过的记忆',
  bytes: '库大小',
  error: '库状态',
  refresh: '刷新',
  now: '此刻',
  nowDesc: '它现在的状态，以及今天的主动/胡思乱想额度。',
  mood: '心情',
  energy: '精力',
  activity: '正在',
  proactiveToday: '今日主动',
  musingToday: '今日走神',
  nextDue: '下次主动',
  recent: '最近记忆',
  recentDesc: '最近写进记忆的 12 条；情绪优先用写入时的 userEmotion，没标时按文本粗判，仍无则为「未标注」。',
  recentEmpty: '还没有记忆。',
  columnEmotion: '情绪',
  columnImportance: '重要度',
  mind: '心理活动',
  mindDesc: '只记决策：为什么开口/没开口、回声用了哪条记忆、夜间整理了没有。',
  mindEmpty: '还没有心理活动记录。',
  mindAll: '全部',
  mindLevel: '日志',
  columnTime: '时间',
  columnSummary: '摘要',
  typeProactive: '主动',
  typeGate: '未开口',
  typeEcho: '回声',
  typeMemory: '记忆',
  typeNightly: '夜间',
  typeError: '错误',
  search: '检索',
  searchDesc: '按关键词查记录（默认不含已归档原文）；scope 留空=当前会话，* =全库。',
  searchPlaceholder: '关键词，例如「加班」「生日」',
  scopePlaceholder: 'scope（可空 / *）',
  searchButton: '搜索',
  emptySearch: '没有命中。',
  columnKind: '类型',
  columnScope: '域',
  columnDate: '日期',
  columnSnippet: '片段',
  merges: '合并摘要',
  mergesDesc: '夜间合并出来的摘要；撤销会恢复原文并删掉这条摘要。',
  emptyMerges: '还没有合并摘要。',
  columnText: '摘要',
  columnCount: '原文条数',
  columnAction: '操作',
  unmerge: '撤销合并',
  unmergeConfirm: '撤销这次合并？',
  unmergeBody: '原文会恢复为可检索，摘要会删除。这个动作可再次合并，但不会丢原文。',
  unmergeMissing: '这条合并摘要已经不存在，可能已被撤销。',
  unmerged: (n) => `已恢复 ${n} 条原文`,
  loading: '读取中…',
  failed: (msg) => `读取失败：${msg}`,
  noError: '正常',
};

const EN = {
  title: 'Memory',
  desc: 'Read-only view of memory: overview, search and merge summaries. Import review stays in the CLI.',
  overview: 'Overview',
  overviewDesc: 'What is in the store, and when consolidation/merge/reflection last ran.',
  records: 'Records',
  events: 'Raw events',
  kinds: 'Kinds',
  scopes: 'Scopes',
  archived: 'Archived',
  merged: 'Merged summaries',
  musing: 'Musings',
  rules: 'Rules',
  people: 'People',
  threads: 'Open threads',
  quarantine: 'Quarantine',
  lastConsolidate: 'Last consolidation',
  lastMerge: 'Last merge',
  lastReflect: 'Last reflection',
  surfaced: 'Surfaced memories',
  bytes: 'Store size',
  error: 'Store state',
  refresh: 'Refresh',
  now: 'Now',
  nowDesc: "Current state and today's proactive/musing budget.",
  mood: 'Mood',
  energy: 'Energy',
  activity: 'Doing',
  proactiveToday: 'Proactive today',
  musingToday: 'Musings today',
  nextDue: 'Next proactive',
  recent: 'Recent memories',
  recentDesc: 'The last 12 memories; emotion comes from userEmotion when tagged, otherwise a conservative text guess, else untagged.',
  recentEmpty: 'No memories yet.',
  columnEmotion: 'Emotion',
  columnImportance: 'Importance',
  mind: 'Mind log',
  mindDesc: 'Decisions only: why it spoke or stayed quiet, which memory an echo used, whether nightly work was delivered.',
  mindEmpty: 'No mind log entries yet.',
  mindAll: 'All',
  mindLevel: 'Log',
  columnTime: 'Time',
  columnSummary: 'Summary',
  typeProactive: 'Proactive',
  typeGate: 'Skipped',
  typeEcho: 'Echo',
  typeMemory: 'Memory',
  typeNightly: 'Nightly',
  typeError: 'Error',
  search: 'Search',
  searchDesc: 'Search records by keyword (archived originals excluded); empty = current session, * = all scopes.',
  searchPlaceholder: 'Keyword, e.g. work or birthday',
  scopePlaceholder: 'scope (empty / *)',
  searchButton: 'Search',
  emptySearch: 'No hits.',
  columnKind: 'Kind',
  columnScope: 'Scope',
  columnDate: 'Date',
  columnSnippet: 'Snippet',
  merges: 'Merge summaries',
  mergesDesc: 'Summaries produced by nightly merging; unmerge restores the originals and removes the summary.',
  emptyMerges: 'No merge summaries yet.',
  columnText: 'Summary',
  columnCount: 'Originals',
  columnAction: 'Action',
  unmerge: 'Unmerge',
  unmergeConfirm: 'Undo this merge?',
  unmergeBody: 'Originals become searchable again and the summary is removed. Re-merging is possible; no text is lost.',
  unmergeMissing: 'This merge summary no longer exists; it may have been undone already.',
  unmerged: (n) => `Restored ${n} originals`,
  loading: 'Loading…',
  failed: (msg) => `Failed: ${msg}`,
  noError: 'OK',
};

export default {
  panels: {
    memory: {
      mount: async (ctx) => {
        const { ui, root } = ctx;
        const S = String(ctx.language ?? '').startsWith('zh') ? ZH : EN;

        const card = ui.sheet({ title: S.title, desc: S.desc });
        const message = ui.msgline();
        const facts = ui.h('div');
        const refresh = ui.button(S.refresh, { onClick: () => { void refreshAll(); } });
        const overview = ui.h('div');
        const overviewHead = ui.section(S.overview, S.overviewDesc);
        const overviewBar = ui.rowbar();
        overviewBar.append(refresh);
        overview.append(overviewHead, facts, overviewBar);

        const nowFacts = ui.h('div');
        const nowSection = ui.h('div');
        nowSection.append(ui.section(S.now, S.nowDesc), nowFacts);

        const recentTable = ui.table({ head: [S.columnEmotion, S.columnKind, S.columnImportance, S.columnDate, S.columnSnippet], maxHeight: '360px' });
        const recentSection = ui.h('div');
        recentSection.append(ui.section(S.recent, S.recentDesc), recentTable.el);

        const mindFilter = ui.select({
          options: [
            { value: '', label: S.mindAll },
            { value: 'proactive', label: S.typeProactive },
            { value: 'gate', label: S.typeGate },
            { value: 'echo', label: S.typeEcho },
            { value: 'memory', label: S.typeMemory },
            { value: 'nightly', label: S.typeNightly },
            { value: 'error', label: S.typeError },
          ],
          onInput: () => { void loadMind(); },
        });
        const mindBar = ui.rowbar();
        mindBar.append(mindFilter);
        const mindTable = ui.table({ head: [S.columnTime, S.columnKind, S.columnSummary], maxHeight: '360px' });
        const mindSection = ui.h('div');
        mindSection.append(ui.section(S.mind, S.mindDesc), mindBar, mindTable.el);

        const searchInput = ui.input({ placeholder: S.searchPlaceholder, cls: 'grow', onCommit: () => { void runSearch(); } });
        const scopeInput = ui.input({ placeholder: S.scopePlaceholder });
        const searchButton = ui.button(S.searchButton, { variant: 'primary', onClick: () => { void runSearch(); } });
        const searchBar = ui.rowbar();
        searchBar.append(searchInput, scopeInput, searchButton);
        const searchTable = ui.table({ head: [S.columnKind, S.columnScope, S.columnDate, S.columnSnippet], maxHeight: '360px' });
        const searchSection = ui.h('div');
        searchSection.append(ui.section(S.search, S.searchDesc), searchBar, searchTable.el);

        const mergeTable = ui.table({ head: [S.columnText, S.columnCount, S.columnAction], maxHeight: '320px' });
        const mergeSection = ui.h('div');
        mergeSection.append(ui.section(S.merges, S.mergesDesc), mergeTable.el);

        card.body.append(overview, nowSection, recentSection, mindSection, searchSection, mergeSection, message);
        root.append(card.el);

        function value(v) {
          return v === undefined || v === null || v === '' ? '—' : String(v);
        }

        function showError(error) {
          message.classList.add('bad');
          message.textContent = S.failed(error instanceof Error ? error.message : String(error));
        }

        async function loadOverview() {
          try {
            const o = await ctx.invoke('overview');
            const kinds = Object.entries(o.byKind ?? {}).map(([k, n]) => `${k} ${n}`).join(' · ') || '—';
            const scopes = Object.entries(o.byScope ?? {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([k, n]) => `${k} ${n}`)
              .join(' · ') || '—';
            facts.replaceChildren(
              ui.kv([
                { k: S.records, v: value(o.records) },
                { k: S.events, v: value(o.events) },
                { k: S.kinds, v: kinds },
                { k: S.scopes, v: scopes },
              ]),
              ui.kv([
                { k: S.rules, v: value(o.rules) },
                { k: S.people, v: value(o.people) },
                { k: S.threads, v: value(o.threads) },
                { k: S.musing, v: value(o.musing) },
              ]),
              ui.kv([
                { k: S.merged, v: value(o.merged) },
                { k: S.archived, v: value(o.archived) },
                { k: S.quarantine, v: value(o.quarantine) },
                { k: S.bytes, v: `${Math.round((Number(o.bytes) || 0) / 1024)} KB` },
              ]),
              ui.kv([
                { k: S.lastConsolidate, v: value(o.lastConsolidateDay) },
                { k: S.lastMerge, v: value(o.lastMergeDay) },
                { k: S.lastReflect, v: value(o.lastReflectWeek) },
                { k: S.surfaced, v: value(o.surfacedMemories) },
              ]),
              ui.kv([{ k: S.error, v: o.error || S.noError }]),
            );
            nowFacts.replaceChildren(
              ui.kv([
                { k: S.mood, v: value(o.mood) },
                { k: S.energy, v: value(o.energy) },
                { k: S.activity, v: value(o.activity) },
                { k: S.nextDue, v: o.nextProactiveDue ? String(o.nextProactiveDue).slice(11, 16) : '—' },
              ]),
              ui.kv([
                { k: S.proactiveToday, v: `${value(o.proactiveToday)} / ${value(o.proactiveCap)}` },
                { k: S.musingToday, v: `${value(o.musingToday)} / ${value(o.musingCap)}` },
                { k: S.mindLevel, v: value(o.mindLogLevel) },
              ]),
            );
            message.classList.remove('bad');
            message.textContent = '';
          } catch (error) {
            showError(error);
          }
        }

        async function runSearch() {
          const query = String(searchInput.value ?? '').trim();
          if (!query) return;
          try {
            const result = await ctx.invoke('search', [query, String(scopeInput.value ?? '').trim(), 10]);
            const hits = result.hits ?? [];
            searchTable.clear(hits.length ? undefined : S.emptySearch);
            for (const hit of hits) {
              searchTable.addRow([
                hit.kind,
                hit.scope,
                hit.date ?? String(hit.ts ?? '').slice(0, 10),
                String(hit.snippet ?? '').slice(0, 180),
              ]);
            }
            message.classList.remove('bad');
            message.textContent = '';
          } catch (error) {
            showError(error);
          }
        }


        async function loadRecent() {
          try {
            const result = await ctx.invoke('recent');
            const rows = result.recent ?? [];
            recentTable.clear(rows.length ? undefined : S.recentEmpty);
            for (const row of rows) {
              recentTable.addRow([
                row.emotion,
                row.kind,
                String(row.importance ?? ''),
                row.date ?? String(row.ts ?? '').slice(0, 10),
                String(row.text ?? '').slice(0, 180),
              ]);
            }
          } catch (error) {
            showError(error);
          }
        }

        async function loadMind() {
          try {
            const result = await ctx.invoke('mind', [80, String(mindFilter.value ?? '')]);
            const events = result.events ?? [];
            const labels = {
              proactive: S.typeProactive,
              gate: S.typeGate,
              echo: S.typeEcho,
              memory: S.typeMemory,
              nightly: S.typeNightly,
              error: S.typeError,
            };
            mindTable.clear(events.length ? undefined : S.mindEmpty);
            for (const event of events) {
              mindTable.addRow([
                event.time ?? String(event.ts ?? '').slice(11, 19),
                event.type === 'proactive' && String(event.summary ?? '').startsWith('没开口：')
                  ? S.typeGate
                  : (labels[event.type] ?? event.type),
                String(event.summary ?? '').slice(0, 220),
              ]);
            }
          } catch (error) {
            showError(error);
          }
        }

        async function loadMerges() {
          try {
            const result = await ctx.invoke('merges');
            const rows = result.merges ?? [];
            mergeTable.clear(rows.length ? undefined : S.emptyMerges);
            for (const row of rows) {
              const unmerge = ui.button(S.unmerge, {
                size: 'sm',
                variant: 'danger',
                onClick: async () => {
                  if (!(await ui.confirm({ title: S.unmergeConfirm, body: S.unmergeBody, danger: true }))) return;
                  try {
                    const undone = await ctx.invoke('unmerge', [row.id]);
                    if (!undone.found || !undone.restored) throw new Error(S.unmergeMissing);
                    ui.toast(S.unmerged(undone.restored ?? 0), 'ok');
                    await refreshAll();
                  } catch (error) {
                    showError(error);
                  }
                },
              });
              mergeTable.addRow([
                String(row.text ?? '').slice(0, 220),
                String(row.count ?? 0),
                unmerge,
              ]);
            }
          } catch (error) {
            showError(error);
          }
        }

        let refreshing = false;
        async function refreshAll() {
          if (refreshing) return;
          refreshing = true;
          try {
            await loadOverview();
            await loadRecent();
            await loadMind();
            await loadMerges();
            await ctx.refresh().catch(() => { /* 顶部徽标刷新失败不影响面板数据。 */ });
          } finally {
            refreshing = false;
          }
        }

        message.textContent = S.loading;
        await loadOverview();
        await loadRecent();
        await loadMind();
        await loadMerges();
        // 面板可见时自动刷新：最近记忆/心理活动 + 顶部「今日主动」徽标；隐藏时跳过。
        ctx.interval(() => {
          if (ctx.root.ownerDocument?.visibilityState === 'hidden') return;
          void refreshAll();
        }, 20_000);
      },
    },
  },
};
